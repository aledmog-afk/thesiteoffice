// netlify/functions/match-entry.js
//
// Phase 2 — AI matching pipeline. Takes a diary entry, asks Claude whether
// it describes a JCT Relevant Event / Relevant Matter, and writes any
// matches to flagged_events. Called by the client right after a diary
// entry is saved (POST { entry_id }); a nightly batch could call the same
// function over unprocessed entries later.
//
// Uses the Anthropic Messages API directly over https (no SDK — this repo
// has no build step / node_modules). Requires ANTHROPIC_API_KEY,
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as Netlify environment
// variables.

const { restAsService, env } = require('./_lib/supabase');
const { requestJSON } = require('./_lib/http');

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clause_ref: { type: 'string', description: 'The clause_ref exactly as given in the reference list, e.g. "2.26.6"' },
          category: { type: 'string', enum: ['relevant_event', 'relevant_matter'] },
          confidence: { type: 'number', description: 'Match confidence from 0 to 1' },
          extracted_summary: { type: 'string', description: 'One or two sentences summarising the evidence in the entry: dates, instruction refs, quantities' },
        },
        required: ['clause_ref', 'category', 'confidence', 'extracted_summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

function daysBetween(dateStr) {
  const then = new Date(dateStr + 'T00:00:00Z').getTime();
  const now = Date.now();
  return Math.max(0, Math.round((now - then) / 86400000));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
    }

    const { entry_id } = JSON.parse(event.body || '{}');
    if (!entry_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'entry_id is required' }) };
    }

    const entryResp = await restAsService(`/diary_entries?id=eq.${entry_id}&select=*`);
    const entry = Array.isArray(entryResp.body) ? entryResp.body[0] : null;
    if (!entry) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Diary entry not found' }) };
    }

    const projectResp = await restAsService(`/projects?id=eq.${entry.project_id}&select=contract_type`);
    const project = Array.isArray(projectResp.body) ? projectResp.body[0] : null;
    const contractType = project ? project.contract_type : 'jct_db';

    const membershipResp = await restAsService(
      `/project_memberships?project_id=eq.${entry.project_id}&org_id=eq.${entry.org_id}&select=tier_type`
    );
    const membership = Array.isArray(membershipResp.body) ? membershipResp.body[0] : null;
    const tierType = membership ? membership.tier_type : 'main_contractor';

    const clausesResp = await restAsService(
      `/jct_clause_reference?contract_type=eq.${contractType}&select=clause_ref,category,title,trigger_keywords,notice_requirement,notice_window_description`
    );
    const clauses = Array.isArray(clausesResp.body) ? clausesResp.body : [];

    if (clauses.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ matches: [], note: 'No clause reference data seeded for this contract type' }) };
    }

    const clauseList = clauses
      .map((c) => `- ${c.clause_ref} [${c.category}] ${c.title} — notice: ${c.notice_requirement} (${c.notice_window_description}). Keywords: ${(c.trigger_keywords || []).join(', ')}`)
      .join('\n');

    const systemPrompt = `You are a construction contracts assistant reviewing a site diary entry against a list of JCT contract clauses (Relevant Events for extension of time, Relevant Matters for loss and expense). For each clause the entry provides real evidence for, return a match with your confidence and a short summary of the evidence (dates, instruction refs, quantities). Only return matches that are actually supported by the entry text — most entries will match nothing. Do not invent evidence that isn't in the text.`;

    const userPrompt = `Diary entry (category: ${entry.category}, date: ${entry.entry_date}):\n"""\n${entry.free_text}\n"""\n\nCandidate clauses for this contract:\n${clauseList}`;

    const aiResp = await requestJSON('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: 'claude-opus-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: {
          format: { type: 'json_schema', schema: MATCH_SCHEMA },
        },
      },
    });

    if (aiResp.statusCode >= 400) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API error', details: aiResp.body }) };
    }

    const message = aiResp.body;
    if (message.stop_reason === 'refusal') {
      return { statusCode: 200, body: JSON.stringify({ matches: [], note: 'Model declined to classify this entry' }) };
    }

    const textBlock = (message.content || []).find((b) => b.type === 'text');
    let parsed = { matches: [] };
    if (textBlock) {
      try { parsed = JSON.parse(textBlock.text); } catch (e) { parsed = { matches: [] }; }
    }

    const days = daysBetween(entry.entry_date);
    const written = [];
    for (const match of parsed.matches || []) {
      if (!match.clause_ref || match.confidence < 0.4) continue; // low-confidence matches aren't worth flagging
      const insertResp = await restAsService('/flagged_events', {
        method: 'POST',
        extraHeaders: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: {
          project_id: entry.project_id,
          entry_id: entry.id,
          org_id: entry.org_id,
          tier_type: tierType,
          clause_ref: match.clause_ref,
          category: match.category,
          confidence: match.confidence,
          extracted_summary: match.extracted_summary,
          days_since_trigger: days,
        },
      });
      if (insertResp.statusCode < 300) written.push(match.clause_ref);
    }

    return { statusCode: 200, body: JSON.stringify({ matches: parsed.matches || [], flagged: written }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
