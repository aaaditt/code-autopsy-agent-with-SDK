"""
Code Autopsy Agent — Google ADK Multi-Agent Pipeline
Pipeline: FetcherTool → ArchitectAgent → BugFinderAgent → RoadmapAgent
"""

import os
import requests
import base64
from dotenv import load_dotenv

from google.adk.agents import LlmAgent
from google.adk.agents.sequential_agent import SequentialAgent

load_dotenv()

GEMINI_MODEL = "gemini-2.0-flash"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

def fetch_github_repo(repo_url: str) -> dict:
    """Fetches file tree and key file contents from a public GitHub repository.

    Args:
        repo_url: Full GitHub URL like https://github.com/owner/repo

    Returns:
        A dict with 'file_tree' (list of paths) and 'file_contents' (dict of path->content).
    """
    try:
        # Parse owner/repo from URL
        parts = repo_url.rstrip("/").split("github.com/")
        if len(parts) < 2:
            return {"error": "Invalid GitHub URL. Expected format: https://github.com/owner/repo"}

        owner_repo = parts[1].strip("/")
        segments = owner_repo.split("/")
        if len(segments) < 2:
            return {"error": "Could not parse owner/repo from URL."}

        owner, repo = segments[0], segments[1]
        api_base = f"https://api.github.com/repos/{owner}/{repo}"
        headers = {"Accept": "application/vnd.github.v3+json"}

        github_token = os.getenv("GITHUB_TOKEN")
        if github_token:
            headers["Authorization"] = f"token {github_token}"

        # Get default branch
        repo_resp = requests.get(api_base, headers=headers, timeout=10)
        if repo_resp.status_code != 200:
            return {"error": f"Repo not found or not accessible. Status: {repo_resp.status_code}"}

        repo_data = repo_resp.json()
        default_branch = repo_data.get("default_branch", "main")
        description = repo_data.get("description", "")
        language = repo_data.get("language", "Unknown")
        stars = repo_data.get("stargazers_count", 0)

        # Get file tree
        tree_resp = requests.get(
            f"{api_base}/git/trees/{default_branch}?recursive=1",
            headers=headers,
            timeout=10
        )
        if tree_resp.status_code != 200:
            return {"error": "Could not fetch repository tree."}

        tree_data = tree_resp.json()
        all_files = [
            item["path"] for item in tree_data.get("tree", [])
            if item["type"] == "blob"
        ]

        # Filter to relevant files (exclude binaries, lock files, etc.)
        IGNORE_EXTENSIONS = {
            ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff",
            ".woff2", ".ttf", ".eot", ".mp4", ".zip", ".tar", ".gz",
            ".lock", ".min.js", ".min.css", ".map"
        }
        IGNORE_PATHS = {
            "node_modules", ".git", "dist", "build", "__pycache__",
            ".venv", "venv", ".next", ".nuxt"
        }

        def should_include(path: str) -> bool:
            if any(seg in path.split("/") for seg in IGNORE_PATHS):
                return False
            ext = os.path.splitext(path)[1].lower()
            if ext in IGNORE_EXTENSIONS:
                return False
            return True

        relevant_files = [f for f in all_files if should_include(f)]

        # Priority files to read
        PRIORITY_NAMES = {
            "readme.md", "readme.txt", "readme",
            "package.json", "requirements.txt", "pyproject.toml",
            "setup.py", "setup.cfg", "cargo.toml", "go.mod",
            "dockerfile", "docker-compose.yml", "docker-compose.yaml",
            ".env.example", "main.py", "app.py", "index.js",
            "index.ts", "server.js", "server.ts"
        }

        def priority(path: str) -> int:
            name = os.path.basename(path).lower()
            depth = path.count("/")
            if name in PRIORITY_NAMES:
                return 0
            if depth == 0:
                return 1
            if depth == 1:
                return 2
            return 3 + depth

        sorted_files = sorted(relevant_files, key=priority)
        # Read up to 25 files, max 3000 chars each
        files_to_read = sorted_files[:25]
        file_contents = {}

        for file_path in files_to_read:
            try:
                content_resp = requests.get(
                    f"{api_base}/contents/{file_path}",
                    headers=headers,
                    timeout=8
                )
                if content_resp.status_code == 200:
                    content_data = content_resp.json()
                    if content_data.get("encoding") == "base64":
                        raw = base64.b64decode(content_data["content"]).decode("utf-8", errors="replace")
                        file_contents[file_path] = raw[:3000]
            except Exception:
                continue

        return {
            "owner": owner,
            "repo": repo,
            "description": description,
            "language": language,
            "stars": stars,
            "default_branch": default_branch,
            "file_tree": relevant_files[:80],
            "file_contents": file_contents,
        }

    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Sub-agents
# ---------------------------------------------------------------------------

architect_agent = LlmAgent(
    name="ArchitectAgent",
    model=GEMINI_MODEL,
    description="Maps the architecture of a GitHub repository from its file tree and contents.",
    instruction="""
You are a senior software architect. You will receive a GitHub repository's metadata, file tree,
and key file contents in the session state under the key 'repo_data'.

Your task is to produce a clear ARCHITECTURE REPORT with these sections:

## 🏗️ Architecture Overview
A 2-3 sentence summary of what this project does and its technical approach.

## 📁 Project Structure
Describe the major directories and their purpose. Group logically.

## 🔧 Tech Stack
List: Language, Frameworks/Libraries, Build tools, Testing tools, Infrastructure/deployment.

## 🔄 Data & Request Flow
Describe the main flow through the system (e.g., HTTP request → handler → service → DB → response).

## 🧩 Key Components
List 4-6 core modules/files with a one-line description of each.

Be specific to THIS codebase. Do not give generic advice. Output only the report, no preamble.
""",
    output_key="architecture_report",
)

bug_finder_agent = LlmAgent(
    name="BugFinderAgent",
    model=GEMINI_MODEL,
    description="Finds bugs, antipatterns, and security issues in a codebase.",
    instruction="""
You are a senior code reviewer and security engineer. You have access to:
- The repository data in session state under 'repo_data'
- The architecture report under 'architecture_report'

Your task is to produce a BUGS & ISSUES REPORT with these sections:

## 🐛 Bugs & Logic Errors
List actual bugs you can identify in the code. For each:
- File path and line/function (if identifiable)
- Description of the bug
- Severity: 🔴 Critical / 🟡 Medium / 🟢 Minor

## 🔐 Security Issues
List security vulnerabilities or bad practices (e.g., hardcoded secrets, SQL injection risk,
missing auth checks, exposed endpoints, insecure dependencies).

## 🚨 Antipatterns
List code quality issues: code duplication, poor separation of concerns, missing error handling,
God classes/functions, etc.

## ⚡ Performance Issues
List any obvious performance problems: N+1 queries, missing indexes, sync where async needed, etc.

If the codebase is small or you can only see limited files, note what you can and be honest about
what you couldn't inspect. Be specific — cite file names and function names. Output only the report.
""",
    output_key="bugs_report",
)

roadmap_agent = LlmAgent(
    name="RoadmapAgent",
    model=GEMINI_MODEL,
    description="Generates a prioritized improvement roadmap based on architecture and bugs found.",
    instruction="""
You are a staff engineer and technical product lead. You have access to:
- The repository data in session state under 'repo_data'
- The architecture report under 'architecture_report'
- The bugs & issues report under 'bugs_report'

Your task is to produce a IMPROVEMENT ROADMAP with these sections:

## 🎯 Executive Summary
2-3 sentences on the overall health of the codebase and the top priority areas.

## 🚀 Phase 1 — Critical Fixes (Do This Week)
3-5 items that should be fixed immediately. Include the bug/issue reference.

## 📈 Phase 2 — Quality Improvements (This Sprint)
4-6 refactoring and quality improvements that will reduce tech debt.

## 🌟 Phase 3 — Feature & Architecture Enhancements (Next Quarter)
3-5 strategic improvements that would significantly improve the project long-term.

## 📊 Health Score
Rate the codebase on a /10 scale for:
- Code Quality: X/10
- Security: X/10
- Architecture: X/10
- Documentation: X/10
- Overall: X/10

End with one sentence of encouragement for the developer.
Output only the roadmap report, no preamble.
""",
    output_key="roadmap_report",
)


# ---------------------------------------------------------------------------
# Orchestrator — SequentialAgent runs the 3 agents in order
# ---------------------------------------------------------------------------

code_autopsy_pipeline = SequentialAgent(
    name="CodeAutopsyPipeline",
    description="Analyzes a GitHub repository: maps architecture, finds bugs, generates improvement roadmap.",
    sub_agents=[architect_agent, bug_finder_agent, roadmap_agent],
)

# ADK requires root_agent to be defined at module level
root_agent = code_autopsy_pipeline
