FROM node:22-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global firebase-tools

WORKDIR /opt/firebase

COPY firebase.json firestore.rules entrypoint.sh ./
RUN sed -i 's/\r$//' /opt/firebase/entrypoint.sh \
    && chmod +x /opt/firebase/entrypoint.sh

EXPOSE 8080 9099 4000

ENTRYPOINT ["/opt/firebase/entrypoint.sh"]
