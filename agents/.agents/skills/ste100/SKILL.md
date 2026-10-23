---
name: ste100
description: |
  Write technical prose in ASD-STE100 style: short sentences, active voice,
  one instruction per sentence, American English. Use when writing or editing
  docs, reports, READMEs, commit messages, PR descriptions, or explanatory
  replies. Not for code, commands, or creative copy.
disable-model-invocation: false
---

# STE100 prose

Write controlled technical English. Draft to these rules. Do not wait for the
linter to find them.

1. **One idea per sentence.** Max 20 words for an instruction, 25 for a
   description. Split the sentence. Do not add more clauses.
2. **Active voice.** Say who or what does the action. Passive is acceptable only
   when the actor is unknown.
3. **Do not use semicolons or contractions.** Write two sentences, or use "and"
   or "then". Write `do not`, not `don't`.
4. **Use can, will, or must.** Avoid `shall`, `should`, `might`, and `could`. Use
   `may` only to give permission.
5. **Max three nouns in a row.** Show the relation with a preposition or a
   verb. Replace `and/or`, `if necessary`, `as required`, and `etc.` with the
   real condition, value, or list.
6. **American English.** Write `color`, `normalize`, `behavior`, and `while`,
   not the British forms.

Keep code, commands, paths, identifiers, and quoted text exactly as written.
Do not simplify a technical term or a number to make a sentence shorter.

At the end of every run that changes prose, validate and fix the text. Do not
wait for the user to ask. Run `ste_validate` after every edit, including edits
inside `codemode`. Pass the file path when the text is on disk. Fix every error.
Fix a warning when the rewrite is accurate. If a finding is a false positive,
leave it and say why in one line.

Never edit the Vale rules, this skill, or its references without the user's
permission. Ask first. Do not change a rule to make a finding disappear. If a
rule is wrong or noisy, report it and wait.

If `ste_validate` is unavailable, run:

    vale --config ~/.config/vale/.vale.ini --ext=.md --output=JSON

Vale exits 1 when it finds alerts. That is normal. For a word choice, use
`ste_lookup`. If it is unavailable, search
`~/.local/share/ste100/wordlist.json`.

Full rule table and examples: `references/rules.md`.
