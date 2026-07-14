#!/usr/bin/env bash
#
# loc-map.sh - Print a tree-style map of tracked files with lines-of-code
#              counts per directory and per file.
#
# What it does:
#   Enumerates TRACKED files only (via `git ls-files`, so .gitignore is
#   respected and node_modules / build output are skipped), counts lines
#   with `wc -l`, and renders an indented tree. Every directory shows its
#   aggregate LOC (recursive sum of all files beneath it) and its file
#   count; every file shows its own LOC. A grand total is printed last.
#
# Dependencies:
#   git and coreutils only. No cloc, tree, tokei, awk-scripts, etc.
#
# Usage:
#   scripts/loc-map.sh [path]
#     path   Optional subtree to scope the report to (default: ".").
#            Example: scripts/loc-map.sh src
#
# Sort order:
#   Directories are sorted by aggregate LOC DESCENDING so the largest
#   areas (the likely bloat) surface first. Files within a directory are
#   likewise sorted by LOC descending. Ties break alphabetically by name.
#   Output is deterministic (stable sort, no timestamps or random data),
#   so it is safe to diff or commit as a snapshot.
#
set -euo pipefail

root="${1:-.}"

# Resolve to the repository root so `git ls-files` and paths line up
# regardless of where the script is invoked from.
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Enumerate tracked files under the requested path.
mapfile -d '' -t files < <(git ls-files -z -- "$root")

if [ "${#files[@]}" -eq 0 ]; then
  echo "No tracked files found under: $root" >&2
  exit 1
fi

declare -A FILE_LOC   # path            -> line count
declare -A DIR_LOC    # directory path  -> aggregate line count
declare -A DIR_COUNT  # directory path  -> file count
declare -A CHILD_DIRS # directory path  -> newline-separated child dirs
declare -A CHILD_FILES # directory path -> newline-separated child files
declare -A DIR_SEEN   # directory path  -> "1" once registered as a child

total_loc=0
total_files=0

# parent_of PATH -> prints the parent directory ("." for top-level entries).
parent_of() {
  case "$1" in
    */*) printf '%s' "${1%/*}" ;;
    *)   printf '.' ;;
  esac
}

# Register a directory as a child of its parent exactly once.
register_dir() {
  local dir="$1" parent
  [ "$dir" = "." ] && return 0
  [ -n "${DIR_SEEN[$dir]:-}" ] && return 0
  DIR_SEEN["$dir"]=1
  parent="$(parent_of "$dir")"
  CHILD_DIRS["$parent"]+="$dir"$'\n'
}

for f in "${files[@]}"; do
  loc="$(wc -l < "$f")"
  loc="${loc//[[:space:]]/}"
  FILE_LOC["$f"]="$loc"
  total_loc=$((total_loc + loc))
  total_files=$((total_files + 1))

  # Record the file under its immediate parent directory.
  parent="$(parent_of "$f")"
  CHILD_FILES["$parent"]+="$f"$'\n'

  # Accumulate LOC and file counts up every ancestor, including root ".".
  dir="$f"
  while :; do
    dir="$(parent_of "$dir")"
    DIR_LOC["$dir"]=$(( ${DIR_LOC["$dir"]:-0} + loc ))
    DIR_COUNT["$dir"]=$(( ${DIR_COUNT["$dir"]:-0} + 1 ))
    register_dir "$dir"
    [ "$dir" = "." ] && break
  done
done

# Column width for right-aligned LOC numbers (min 6, grows with the total).
loc_width=${#total_loc}
[ "$loc_width" -lt 6 ] && loc_width=6

# print_row LOC INDENT LABEL
print_row() {
  printf '%*d  %s%s\n' "$loc_width" "$1" "$2" "$3"
}

# render DIR DEPTH -> print the directory's children (dirs then files),
# each subtree sorted by LOC descending.
render() {
  local dir="$1" depth="$2"
  local indent="" i
  for ((i = 0; i < depth; i++)); do
    indent+="  "
  done

  # Child directories, sorted by aggregate LOC desc, name asc on ties.
  local child_dirs="${CHILD_DIRS[$dir]:-}"
  if [ -n "$child_dirs" ]; then
    local sorted_dirs
    sorted_dirs="$(
      while IFS= read -r d; do
        [ -z "$d" ] && continue
        printf '%s\t%s\n' "${DIR_LOC[$d]:-0}" "$d"
      done <<< "$child_dirs" | sort -t$'\t' -k1,1nr -k2,2
    )"
    while IFS=$'\t' read -r dloc d; do
      [ -z "$d" ] && continue
      local name="${d##*/}"
      print_row "$dloc" "$indent" "${name}/  (${DIR_COUNT[$d]:-0} files)"
      render "$d" $((depth + 1))
    done <<< "$sorted_dirs"
  fi

  # Child files, sorted by LOC desc, name asc on ties.
  local child_files="${CHILD_FILES[$dir]:-}"
  if [ -n "$child_files" ]; then
    local sorted_files
    sorted_files="$(
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        printf '%s\t%s\n' "${FILE_LOC[$f]:-0}" "$f"
      done <<< "$child_files" | sort -t$'\t' -k1,1nr -k2,2
    )"
    while IFS=$'\t' read -r floc f; do
      [ -z "$f" ] && continue
      print_row "$floc" "$indent  " "${f##*/}"
    done <<< "$sorted_files"
  fi
}

# Determine the top node of the scoped tree. For the default "." we start at
# the repository root; for an explicit path we root the tree at that path
# itself (normalizing away a leading "./" or a trailing "/") so the report is
# not padded with redundant ancestor rows.
top="$root"
top="${top#./}"
top="${top%/}"
[ -z "$top" ] && top="."

if [ "$top" = "." ]; then
  print_row "${DIR_LOC[.]:-0}" "" ".  (${DIR_COUNT[.]:-0} files)"
  render "." 1
elif [ -n "${DIR_LOC[$top]:-}" ]; then
  print_row "${DIR_LOC[$top]}" "" "${top}/  (${DIR_COUNT[$top]} files)"
  render "$top" 1
elif [ -n "${FILE_LOC[$top]:-}" ]; then
  # Scoped to a single tracked file.
  print_row "${FILE_LOC[$top]}" "" "$top"
fi

# Grand total.
printf '%*s\n' $((loc_width + 2)) "" | tr ' ' '-'
print_row "$total_loc" "" "TOTAL  (${total_files} files, ${total_loc} lines)"
