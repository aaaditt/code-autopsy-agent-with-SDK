"""
Flask API server for Code Autopsy
Wraps the ADK SequentialAgent pipeline and exposes a REST endpoint.
"""

import os
import json
import asyncio
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from code_autopsy_agent.agent import root_agent, fetch_github_repo

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["*"])

APP_NAME = "code-autopsy"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_runner() -> Runner:
    session_service = InMemorySessionService()
    return Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=session_service,
    )


async def run_pipeline(repo_url: str) -> dict:
    """Run the full ADK pipeline for a given repo URL. Returns all reports."""

    # Fetch GitHub data first (before creating session)
    repo_data = fetch_github_repo(repo_url)
    if "error" in repo_data:
        return {"error": repo_data["error"]}

    runner = make_runner()
    session_service = runner.session_service

    # Create session with state pre-populated in one call
    session = await session_service.create_session(
        app_name=APP_NAME,
        user_id="user",
        state={"repo_data": json.dumps(repo_data, indent=2)},
    )

    user_message = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=f"Analyze this GitHub repository: {repo_url}")],
    )

    final_response = ""
    async for event in runner.run_async(
        user_id="user",
        session_id=session.id,
        new_message=user_message,
    ):
        if event.is_final_response() and event.content:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    final_response += part.text

    # Pull all output_keys from the session state
    updated_session = await session_service.get_session(
        app_name=APP_NAME,
        user_id="user",
        session_id=session.id,
    )
    state = updated_session.state if updated_session else {}

    return {
        "repo": {
            "owner": repo_data.get("owner"),
            "repo": repo_data.get("repo"),
            "description": repo_data.get("description"),
            "language": repo_data.get("language"),
            "stars": repo_data.get("stars"),
            "file_count": len(repo_data.get("file_tree", [])),
        },
        "architecture_report": state.get("architecture_report", ""),
        "bugs_report": state.get("bugs_report", ""),
        "roadmap_report": state.get("roadmap_report", ""),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "Code Autopsy API"})


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /analyze
    Body: { "repo_url": "https://github.com/owner/repo" }
    Returns: { repo, architecture_report, bugs_report, roadmap_report }
    """
    data = request.get_json()
    if not data or "repo_url" not in data:
        return jsonify({"error": "Missing 'repo_url' in request body"}), 400

    repo_url = data["repo_url"].strip()
    if "github.com" not in repo_url:
        return jsonify({"error": "Only GitHub URLs are supported"}), 400

    try:
        result = asyncio.run(run_pipeline(repo_url))
        if "error" in result:
            return jsonify(result), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/fetch-repo", methods=["POST"])
def fetch_repo():
    """
    POST /fetch-repo  — lightweight endpoint to just fetch repo metadata (no AI)
    Body: { "repo_url": "..." }
    """
    data = request.get_json()
    if not data or "repo_url" not in data:
        return jsonify({"error": "Missing repo_url"}), 400
    result = fetch_github_repo(data["repo_url"])
    if "error" in result:
        return jsonify(result), 400
    # Return only metadata (not file contents — too large)
    return jsonify({
        "owner": result.get("owner"),
        "repo": result.get("repo"),
        "description": result.get("description"),
        "language": result.get("language"),
        "stars": result.get("stars"),
        "file_count": len(result.get("file_tree", [])),
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)