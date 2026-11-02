#!/system/bin/sh
# Cargo invokes this as: /system/bin/sh <this-file> <rustc-args...>
# Re-exec under the bionic exec hook so the musl rustc (and its linker) can run.
if [ -z "${AEGIS_RUSTC_REEXEC:-}" ]; then
  export AEGIS_RUSTC_REEXEC=1
  export LD_PRELOAD="/data/app/~~LBrfe5rwLfywhlRE3emgWw==/com.mobileide.app.phonetest-XhOV6rrVclz2bvmHhdCYQQ==/lib/arm64/liblib_adev_exec_compat.so:/data/app/~~LBrfe5rwLfywhlRE3emgWw==/com.mobileide.app.phonetest-XhOV6rrVclz2bvmHhdCYQQ==/lib/arm64/liblib_libtermux_exec_linker_ld_preload_so.so"
  export LD_LIBRARY_PATH="/data/user/0/com.mobileide.app.phonetest/files/runtime/lib:/data/app/~~LBrfe5rwLfywhlRE3emgWw==/com.mobileide.app.phonetest-XhOV6rrVclz2bvmHhdCYQQ==/lib/arm64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  exec /system/bin/sh "$0" "$@"
fi
exec /data/user/0/com.mobileide.app.phonetest/files/runtime/linux/rootfs/lib/ld-musl-aarch64.so.1 \
  /data/user/0/com.mobileide.app.phonetest/files/runtime/home/.rustup/toolchains/nightly-aarch64-unknown-linux-musl/bin/rustc \
  "$@"
