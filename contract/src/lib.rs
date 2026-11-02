use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

/// Actions an AEGIS agent may attest and commit to the vault.
const ACTION_TYPES: [&str; 5] = ["swap", "transfer", "withdraw", "shield", "unshield"];

/// One TEE-attested agent action, stored by `correlation_id`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedExecution {
    pub correlation_id: String,
    pub agent_id: String,
    /// One of "swap", "transfer", "withdraw", "shield", "unshield".
    pub action_type: String,
    pub origin_asset: String,
    pub destination_asset: String,
    pub amount_atomic: String,
    pub near_ai_chat_id: String,
    pub tee_signing_address: String,
    pub request_sha256: String,
    pub response_sha256: String,
    pub tee_signature: String,
    pub timestamp_ns: u64,
}

/// On-chain audit vault for verifiable private AI and cross-chain intents.
#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    owner: AccountId,
    agent_account: AccountId,
    paused: bool,
    executions: IterableMap<String, VerifiedExecution>,
    /// Insertion order. Newest records are at the end so `list_executions`
    /// can page in reverse chronological order.
    execution_keys: Vec<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn init(owner: AccountId, agent_account: AccountId) -> Self {
        Self {
            owner,
            agent_account,
            paused: false,
            executions: IterableMap::new(b"e"),
            execution_keys: Vec::new(),
        }
    }

    /// Persist a verified execution. Caller must be the owner or the agent,
    /// and the vault must not be paused. A repeated `correlation_id` updates
    /// the stored record and keeps its original position in the log.
    pub fn record_execution(&mut self, execution: VerifiedExecution) {
        require!(!self.paused, "Contract is paused");
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner || caller == self.agent_account,
            "Unauthorized"
        );
        require!(
            ACTION_TYPES.contains(&execution.action_type.as_str()),
            "Invalid action_type"
        );
        require!(
            !execution.correlation_id.is_empty(),
            "correlation_id is required"
        );

        let key = execution.correlation_id.clone();
        let is_new = !self.executions.contains_key(&key);
        self.executions.insert(key.clone(), execution);
        if is_new {
            self.execution_keys.push(key);
        }
    }

    /// Emergency freeze. Only the owner may pause or unpause the vault.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    /// Rotate the account allowed to record executions alongside the owner.
    pub fn update_agent_account(&mut self, agent_account: AccountId) {
        self.assert_owner();
        self.agent_account = agent_account;
    }

    pub fn get_execution(&self, correlation_id: String) -> Option<VerifiedExecution> {
        self.executions.get(&correlation_id).cloned()
    }

    /// Page executions newest-first.
    ///
    /// `from_index` is the offset from the newest record. `limit` is the
    /// maximum number of records to return.
    pub fn list_executions(&self, from_index: usize, limit: usize) -> Vec<VerifiedExecution> {
        if limit == 0 || from_index >= self.execution_keys.len() {
            return Vec::new();
        }
        self.execution_keys
            .iter()
            .rev()
            .skip(from_index)
            .take(limit)
            .filter_map(|key| self.executions.get(key).cloned())
            .collect()
    }

    /// `(owner, agent_account, paused, total_executions)`.
    pub fn get_vault_info(&self) -> (AccountId, AccountId, bool, u32) {
        (
            self.owner.clone(),
            self.agent_account.clone(),
            self.paused,
            self.execution_keys.len() as u32,
        )
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Unauthorized: caller is not the owner"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn switch_caller(predecessor: AccountId) {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(accounts(0))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor);
        testing_env!(ctx.build());
    }

    fn init_vault() -> Contract {
        switch_caller(accounts(0));
        Contract::init(accounts(0), accounts(1))
    }

    fn execution(correlation_id: &str, action_type: &str, timestamp_ns: u64) -> VerifiedExecution {
        VerifiedExecution {
            correlation_id: correlation_id.to_string(),
            agent_id: "aegis-agent.near".to_string(),
            action_type: action_type.to_string(),
            origin_asset: "nep141:wrap.near".to_string(),
            destination_asset: "nep141:usdc.fakes.testnet".to_string(),
            amount_atomic: "1000000000000000000000000".to_string(),
            near_ai_chat_id: format!("chat-{correlation_id}"),
            tee_signing_address: "ed25519:AEGISTeeSigningKey1111111111111111111111111".to_string(),
            request_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                .to_string(),
            response_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                .to_string(),
            tee_signature: format!("sig-{correlation_id}"),
            timestamp_ns,
        }
    }

    #[test]
    fn init_sets_owner_agent_and_unpaused_vault() {
        let contract = init_vault();
        let (owner, agent, paused, total) = contract.get_vault_info();
        assert_eq!(owner, accounts(0));
        assert_eq!(agent, accounts(1));
        assert!(!paused);
        assert_eq!(total, 0);
        assert!(contract.get_execution("missing".to_string()).is_none());
        assert!(contract.list_executions(0, 10).is_empty());
    }

    #[test]
    fn owner_and_agent_can_record_and_list_newest_first() {
        let mut contract = init_vault();

        switch_caller(accounts(0));
        contract.record_execution(execution("corr-1", "swap", 1));

        switch_caller(accounts(1));
        contract.record_execution(execution("corr-2", "transfer", 2));
        contract.record_execution(execution("corr-3", "shield", 3));

        let (owner, agent, paused, total) = contract.get_vault_info();
        assert_eq!(owner, accounts(0));
        assert_eq!(agent, accounts(1));
        assert!(!paused);
        assert_eq!(total, 3);

        let stored = contract.get_execution("corr-2".to_string()).expect("corr-2");
        assert_eq!(stored.action_type, "transfer");
        assert_eq!(stored.timestamp_ns, 2);

        let newest_two = contract.list_executions(0, 2);
        assert_eq!(
            newest_two
                .iter()
                .map(|item| item.correlation_id.as_str())
                .collect::<Vec<_>>(),
            vec!["corr-3", "corr-2"]
        );

        let page_two = contract.list_executions(1, 2);
        assert_eq!(
            page_two
                .iter()
                .map(|item| item.correlation_id.as_str())
                .collect::<Vec<_>>(),
            vec!["corr-2", "corr-1"]
        );

        assert_eq!(contract.list_executions(0, 10).len(), 3);
        assert!(contract.list_executions(3, 1).is_empty());
        assert!(contract.list_executions(0, 0).is_empty());

        // Updating an existing id must not create a second log entry.
        let mut updated = execution("corr-1", "withdraw", 9);
        updated.amount_atomic = "42".to_string();
        switch_caller(accounts(0));
        contract.record_execution(updated);
        assert_eq!(contract.get_vault_info().3, 3);
        assert_eq!(
            contract
                .get_execution("corr-1".to_string())
                .expect("updated")
                .amount_atomic,
            "42"
        );
        assert_eq!(
            contract.list_executions(0, 1)[0].correlation_id,
            "corr-3",
            "updates keep the original chronological position"
        );
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn unauthorized_caller_cannot_record_execution() {
        let mut contract = init_vault();
        switch_caller(accounts(2));
        contract.record_execution(execution("corr-x", "swap", 1));
    }

    #[test]
    #[should_panic(expected = "Unauthorized: caller is not the owner")]
    fn unauthorized_caller_cannot_pause() {
        let mut contract = init_vault();
        switch_caller(accounts(1));
        contract.set_paused(true);
    }

    #[test]
    #[should_panic(expected = "Contract is paused")]
    fn set_paused_freezes_record_execution() {
        let mut contract = init_vault();
        switch_caller(accounts(0));
        contract.set_paused(true);
        let (_, _, paused, _) = contract.get_vault_info();
        assert!(paused);
        contract.record_execution(execution("corr-frozen", "unshield", 4));
    }

    #[test]
    fn owner_can_unpause_and_rotate_agent() {
        let mut contract = init_vault();
        switch_caller(accounts(0));
        contract.set_paused(true);
        contract.set_paused(false);
        contract.update_agent_account(accounts(2));

        switch_caller(accounts(2));
        contract.record_execution(execution("corr-new-agent", "withdraw", 5));
        assert_eq!(contract.get_vault_info().1, accounts(2));
        assert!(contract
            .get_execution("corr-new-agent".to_string())
            .is_some());
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn previous_agent_is_rejected_after_rotation() {
        let mut contract = init_vault();
        switch_caller(accounts(0));
        contract.update_agent_account(accounts(2));
        switch_caller(accounts(1));
        contract.record_execution(execution("corr-old-agent", "swap", 6));
    }

    #[test]
    #[should_panic(expected = "Invalid action_type")]
    fn invalid_action_type_is_rejected() {
        let mut contract = init_vault();
        switch_caller(accounts(0));
        contract.record_execution(execution("corr-bad", "mint", 7));
    }
}
