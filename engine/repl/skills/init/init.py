#!/usr/bin/env python3
"""
Non-interactive project initializer for flowai-workflow.

Autodetects project name, default branch, test and lint commands,
then calls `flowai-workflow init --answers <tmpfile>` to scaffold
the .flowai-workflow/ directory.

Usage:
    python3 init.py [--template <name>] [--dry-run] [--allow-dirty]
"""

import json
import os
import subprocess
import sys
import tempfile


def read_json(path):
    """Read and parse a JSON file, return None on any error."""
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def read_text(path):
    """Read a text file, return None on any error."""
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return None


def detect_project_name(root):
    """Detect project name from manifest files or directory name."""
    deno = read_json(os.path.join(root, "deno.json"))
    if deno and deno.get("name"):
        return deno["name"]

    pkg = read_json(os.path.join(root, "package.json"))
    if pkg and pkg.get("name"):
        return pkg["name"]

    go_mod = read_text(os.path.join(root, "go.mod"))
    if go_mod:
        for line in go_mod.splitlines():
            if line.strip().startswith("module "):
                return line.strip().split()[-1].split("/")[-1]

    return os.path.basename(os.path.abspath(root))


def detect_default_branch():
    """Detect default branch from git remote HEAD."""
    try:
        result = subprocess.run(
            ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            ref = result.stdout.strip()
            prefix = "refs/remotes/origin/"
            if ref.startswith(prefix):
                return ref[len(prefix):]
    except Exception:
        pass
    return "main"


def detect_test_cmd(root):
    """Detect test command from project manifests."""
    deno = read_json(os.path.join(root, "deno.json"))
    if deno:
        tasks = deno.get("tasks", {})
        if "test" in tasks:
            t = tasks["test"]
            return t if isinstance(t, str) else t.get("command", "deno task test")
        return "deno task test"

    pkg = read_json(os.path.join(root, "package.json"))
    if pkg:
        scripts = pkg.get("scripts", {})
        return scripts.get("test", "npm test")

    if os.path.exists(os.path.join(root, "Cargo.toml")):
        return "cargo test"
    if os.path.exists(os.path.join(root, "go.mod")):
        return "go test ./..."
    if os.path.exists(os.path.join(root, "pyproject.toml")):
        return "pytest"

    return ""


def detect_lint_cmd(root):
    """Detect lint/check command from project manifests."""
    deno = read_json(os.path.join(root, "deno.json"))
    if deno:
        tasks = deno.get("tasks", {})
        if "check" in tasks:
            t = tasks["check"]
            return t if isinstance(t, str) else t.get("command", "deno task check")
        return "deno task check"

    pkg = read_json(os.path.join(root, "package.json"))
    if pkg:
        scripts = pkg.get("scripts", {})
        return scripts.get("lint", "npm run lint")

    if os.path.exists(os.path.join(root, "Cargo.toml")):
        return "cargo clippy"
    if os.path.exists(os.path.join(root, "go.mod")):
        return "go vet ./..."

    return ""


def main():
    root = os.getcwd()

    # Parse our own flags, pass the rest to flowai-workflow init
    passthrough = []
    i = 1
    while i < len(sys.argv):
        passthrough.append(sys.argv[i])
        i += 1

    # Autodetect
    answers = {
        "PROJECT_NAME": detect_project_name(root),
        "DEFAULT_BRANCH": detect_default_branch(),
        "TEST_CMD": detect_test_cmd(root),
        "LINT_CMD": detect_lint_cmd(root),
    }

    # Show what we detected
    print("Detected project settings:")
    for k, v in answers.items():
        print(f"  {k}: {v or '<empty>'}")
    print()

    # Write answers to temp YAML file
    yaml_lines = []
    for k, v in answers.items():
        # YAML string quoting
        yaml_lines.append(f'{k}: "{v}"')
    yaml_content = "\n".join(yaml_lines) + "\n"

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", prefix="flowai-init-", delete=False
    ) as f:
        f.write(yaml_content)
        answers_path = f.name

    try:
        cmd = ["flowai-workflow", "init", "--answers", answers_path] + passthrough
        print(f"Running: {' '.join(cmd)}\n")
        result = subprocess.run(cmd)
        sys.exit(result.returncode)
    finally:
        os.unlink(answers_path)


if __name__ == "__main__":
    main()
