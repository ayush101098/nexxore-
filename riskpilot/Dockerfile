# The always-on RiskPilot agent: demo chain (anvil) + engine, one container. See deploy/entrypoint.sh.
FROM python:3.12-slim
ARG FOUNDRY=v1.3.5
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY}/foundry_${FOUNDRY}_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin anvil \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY engine/requirements.txt engine/requirements.txt
RUN pip install --no-cache-dir -r engine/requirements.txt
COPY shared/schemas/ shared/schemas/
COPY engine/ engine/
COPY web/index.html web/adapters.js web/
COPY contracts/arc/deployments/arc-testnet.json contracts/arc/deployments/arc-testnet.json
COPY deploy/ deploy/
EXPOSE 8000
CMD ["bash", "deploy/entrypoint.sh"]
