# Single Docker image for all SDLC pipeline stages.
# See: documents/requirements.md FR-12, documents/design.md §3.1.
# Contents: claude CLI, deno, git, gh CLI, gitleaks, jq, yq.

FROM node:22-slim

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# System deps: git, curl, unzip, jq (for JSON parsing in stage scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    jq \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install claude CLI (FR-12: npm install -g @anthropic-ai/claude-code)
RUN npm install -g @anthropic-ai/claude-code

# Install deno
ENV DENO_INSTALL=/usr/local
RUN curl -fsSL https://deno.land/install.sh | sh -s -- --yes

# Install gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list && \
  apt-get update && apt-get install -y --no-install-recommends gh && \
  rm -rf /var/lib/apt/lists/*

# Install gitleaks (FR-8: secret detection in diff-based safety checks)
ARG GITLEAKS_VERSION=8.21.2
RUN ARCH=$(dpkg --print-architecture) && \
  curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${ARCH}.tar.gz" \
    | tar xz -C /usr/local/bin gitleaks && \
  chmod +x /usr/local/bin/gitleaks

# Install yq (FR-5: YAML frontmatter parsing in stage scripts)
ARG YQ_VERSION=4.44.6
RUN ARCH=$(dpkg --print-architecture) && \
  curl -fsSL "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${ARCH}" \
    -o /usr/local/bin/yq && \
  chmod +x /usr/local/bin/yq

# Configure git for pipeline commits
RUN git config --system user.name "auto-flow[bot]" && \
    git config --system user.email "auto-flow[bot]@users.noreply.github.com"

WORKDIR /workspace
