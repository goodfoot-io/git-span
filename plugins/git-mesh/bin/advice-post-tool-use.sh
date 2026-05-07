#!/usr/bin/env bash
# PostToolUse: recording-only. For `Read`, record an anchor read; for
# Edit/Write/MultiEdit, record payload-driven `touch` rows; for everything
# else, run `diff <tool_use_id>` against the snapshot captured at PreToolUse.
# Never emits stdout on success — suggestions are surfaced only when a
# caller invokes `git mesh advice <sid> flush` on demand.

set -uo pipefail
. "$(dirname "$0")/advice-common.sh"

read_hook_input

sid="$(hook_field '.session_id')"
[ -n "$sid" ] || exit 0
cwd="$(hook_field '.cwd')"
[ -n "$cwd" ] || cwd="$PWD"
tool="$(hook_field '.tool_name')"
tuid="$(hook_field '.tool_use_id')"

case "$tool" in
  Read)
    fp_raw="$(hook_field '.tool_input.file_path')"
    [ -n "$fp_raw" ] || exit 0
    fp="$(abspath_against "$cwd" "$fp_raw")"
    file_root="$(resolve_repo_root "$(dirname "$fp")")"
    [ -n "$file_root" ] || exit 0

    offset="$(hook_field '.tool_input.offset')"
    limit="$(hook_field '.tool_input.limit')"
    rel="${fp#"$file_root"/}"
    anchor="$rel"
    if [ -n "$offset" ] && [ -n "$limit" ]; then
      end=$((offset + limit - 1))
      anchor="${rel}#L${offset}-L${end}"
    fi

    if [ -n "$tuid" ]; then
      run_advice_verb "$file_root" "$sid" read "$anchor" "$tuid"
    else
      run_advice_verb "$file_root" "$sid" read "$anchor"
    fi
    ;;

  Edit|MultiEdit)
    fp_raw="$(hook_field '.tool_input.file_path')"
    [ -n "$fp_raw" ] || exit 0
    [ -n "$tuid" ] || exit 0
    fp="$(abspath_against "$cwd" "$fp_raw")"
    root="$(resolve_repo_root "$(dirname "$fp")")"
    [ -n "$root" ] || exit 0
    rel="${fp#"$root"/}"

    patch_json="$(printf '%s' "$HOOK_INPUT" | jq -c '.tool_response.structuredPatch // empty')"
    if [ -z "$patch_json" ] || [ "$patch_json" = "[]" ]; then
      run_advice_verb "$root" "$sid" touch "$tuid" "$rel" modified
    else
      whole_file=0
      while IFS= read -r hunk; do
        new_start="$(printf '%s' "$hunk" | jq -r '.newStart // empty')"
        new_lines="$(printf '%s' "$hunk" | jq -r '.newLines // empty')"
        [ -n "$new_start" ] && [ -n "$new_lines" ] || continue
        if [ "$new_lines" -eq 0 ]; then
          whole_file=1
          break
        fi
        end_line=$(( new_start + new_lines - 1 ))
        anchor="${rel}#L${new_start}-L${end_line}"
        run_advice_verb "$root" "$sid" touch "$tuid" "$anchor" modified
      done < <(printf '%s' "$patch_json" | jq -c '.[]')
      if [ "$whole_file" -eq 1 ]; then
        run_advice_verb "$root" "$sid" touch "$tuid" "$rel" modified
      fi
    fi
    ;;

  Write)
    fp_raw="$(hook_field '.tool_input.file_path')"
    [ -n "$fp_raw" ] || exit 0
    [ -n "$tuid" ] || exit 0
    fp="$(abspath_against "$cwd" "$fp_raw")"
    root="$(resolve_repo_root "$(dirname "$fp")")"
    [ -n "$root" ] || exit 0
    rel="${fp#"$root"/}"

    wtype="$(hook_field '.tool_response.type')"
    kind="modified"
    [ "$wtype" = "create" ] && kind="added"

    run_advice_verb "$root" "$sid" touch "$tuid" "$rel" "$kind"
    ;;

  *)
    [ -n "$tuid" ] || exit 0
    root="$(resolve_repo_root "$cwd")"
    [ -n "$root" ] || exit 0
    run_advice_verb "$root" "$sid" diff "$tuid"
    ;;
esac

exit 0
