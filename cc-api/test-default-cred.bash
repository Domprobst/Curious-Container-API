#!/bin/bash
export PRIVATE_KEY="`cat ~/.ssh/id_rsa`"
node test-default-cred.js
