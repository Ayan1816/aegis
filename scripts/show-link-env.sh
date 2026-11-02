#!/system/bin/sh
{
  echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH-UNSET}"
  echo "LD_PRELOAD=${LD_PRELOAD-UNSET}"
  echo "argc=$#"
  echo "0=$0"
  echo "1=${1-}"
} > /data/data/com.mobileide.app.phonetest/files/runtime/home/.grok/link-env.txt
exit 1
