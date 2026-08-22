/*
 * RAMS Auditor scoring engine.
 * Pure, dependency-free JS. Works in the browser (window.RamsAuditor) and in
 * Node (module.exports) so the same logic that runs on the page can be
 * unit-tested and reused by other tools/agents.
 *
 * analyze(text, rules) -> report (see bottom of file for shape)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RamsAuditor = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function compile(patternSource) {
    return new RegExp(patternSource, 'i');
  }

  function matchAny(text, patternSources) {
    for (var i = 0; i < patternSources.length; i++) {
      if (compile(patternSources[i]).test(text)) return true;
    }
    return false;
  }

  function matchAll(text, patternSources) {
    for (var i = 0; i < patternSources.length; i++) {
      if (!compile(patternSources[i]).test(text)) return false;
    }
    return true;
  }

  // Trigger matching ignores a hit if it's immediately preceded by a negation
  // cue ("dust suppression not required" should NOT trigger the dust-hazard
  // check just because the word "dust" appears).
  var NEGATION_BEFORE_RE = /\b(no|not|none|n\/a|without|excluding|except|isn't|is not|are not)\b[^.]{0,30}$/i;
  var NEGATION_AFTER_RE = /^[^.]{0,30}\b(not required|not applicable|not needed|not necessary|n\/a)\b/i;

  function isNegatedContext(text, matchStart, matchEnd) {
    var before = text.slice(Math.max(0, matchStart - 45), matchStart);
    var after = text.slice(matchEnd, matchEnd + 45);
    return NEGATION_BEFORE_RE.test(before) || NEGATION_AFTER_RE.test(after);
  }

  function triggerMatch(text, patternSources) {
    for (var i = 0; i < patternSources.length; i++) {
      var re = new RegExp(patternSources[i], 'gi');
      var m;
      while ((m = re.exec(text)) !== null) {
        if (!isNegatedContext(text, m.index, m.index + m[0].length)) return true;
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    }
    return false;
  }

  function gradeFor(percent, grading) {
    var sorted = grading.slice().sort(function (a, b) { return b.min - a.min; });
    for (var i = 0; i < sorted.length; i++) {
      if (percent >= sorted[i].min) return sorted[i].label;
    }
    return sorted[sorted.length - 1].label;
  }

  function analyze(text, rules) {
    text = String(text || '');

    var structuralResults = rules.structuralChecks.map(function (check) {
      var patterns = check.patterns || [];
      var passed = check.requireAll ? matchAll(text, patterns) : matchAny(text, patterns);
      return {
        id: check.id,
        name: check.name,
        weight: check.weight,
        status: passed ? 'pass' : 'fail',
        guidance: check.guidance,
        reference: check.reference
      };
    });

    var hazardResults = rules.hazardChecks.map(function (check) {
      var triggered = triggerMatch(text, check.triggerPatterns || []);
      var passed = triggered ? matchAny(text, check.requiredPatterns || []) : null;
      return {
        id: check.id,
        name: check.name,
        weight: check.weight,
        triggered: triggered,
        status: !triggered ? 'not_applicable' : (passed ? 'pass' : 'fail'),
        guidance: check.guidance,
        reference: check.reference
      };
    });

    var vagueFlags = [];
    (rules.vagueLanguageFlags || []).forEach(function (flag) {
      var re = new RegExp(flag.pattern, 'gi');
      var matches = text.match(re);
      if (matches && matches.length) {
        vagueFlags.push({
          id: flag.id,
          message: flag.message,
          count: matches.length,
          deduction: flag.deduction * matches.length
        });
      }
    });

    var maxScore = 0;
    var earnedScore = 0;

    structuralResults.forEach(function (r) {
      maxScore += r.weight;
      if (r.status === 'pass') earnedScore += r.weight;
    });

    hazardResults.forEach(function (r) {
      if (r.triggered) {
        maxScore += r.weight;
        if (r.status === 'pass') earnedScore += r.weight;
      }
    });

    var vagueDeductionRaw = vagueFlags.reduce(function (sum, f) { return sum + f.deduction; }, 0);
    var vagueDeductionCap = Math.round(maxScore * 0.2); // never let wording alone fail an otherwise complete doc
    var vagueDeduction = Math.min(vagueDeductionRaw, vagueDeductionCap);

    var finalScore = Math.max(0, earnedScore - vagueDeduction);
    var percent = maxScore > 0 ? Math.round((finalScore / maxScore) * 100) : 0;

    return {
      version: rules.version,
      percent: percent,
      grade: gradeFor(percent, rules.grading),
      maxScore: maxScore,
      earnedScore: earnedScore,
      vagueDeduction: vagueDeduction,
      structuralResults: structuralResults,
      hazardResults: hazardResults,
      vagueFlags: vagueFlags,
      summary: {
        structuralPassed: structuralResults.filter(function (r) { return r.status === 'pass'; }).length,
        structuralTotal: structuralResults.length,
        hazardsDetected: hazardResults.filter(function (r) { return r.triggered; }).length,
        hazardsMissingControls: hazardResults.filter(function (r) { return r.status === 'fail'; }).length
      }
    };
  }

  return { analyze: analyze, gradeFor: gradeFor };
});
