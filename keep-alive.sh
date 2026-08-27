#!/bin/bash
cd /home/z/my-project
if ! pgrep -f "next-server" > /dev/null 2>&1; then
  setsid bash -c 'exec bun run dev' >> /home/z/my-project/dev.log 2>&1
  disown
fi
