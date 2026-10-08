#!/bin/sh
set -eu

mkdir -p /opt/firebase/data

if [ -f /opt/firebase/data/firebase-export-metadata.json ]; then
    exec firebase emulators:start \
        --project "${FIREBASE_PROJECT_ID:-demo-portonscreen}" \
        --only auth,firestore \
        --import=/opt/firebase/data \
        --export-on-exit=/opt/firebase/data
fi

exec firebase emulators:start \
    --project "${FIREBASE_PROJECT_ID:-demo-portonscreen}" \
    --only auth,firestore \
    --export-on-exit=/opt/firebase/data
