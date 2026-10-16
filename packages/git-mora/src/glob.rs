//! Case-sensitive whole-name globbing: `*` (spans slashes), `?`, and `[...]` classes.

enum Tok {
    Star,
    Any,
    Lit(char),
    Class(bool, Vec<(char, char)>),
}

fn tokenize(pattern: &str) -> Vec<Tok> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                if !matches!(toks.last(), Some(Tok::Star)) {
                    toks.push(Tok::Star);
                }
                i += 1;
            }
            '?' => {
                toks.push(Tok::Any);
                i += 1;
            }
            '\\' if i + 1 < chars.len() => {
                toks.push(Tok::Lit(chars[i + 1]));
                i += 2;
            }
            '[' => match class(&chars, i) {
                Some((tok, next)) => {
                    toks.push(tok);
                    i = next;
                }
                None => {
                    toks.push(Tok::Lit('['));
                    i += 1;
                }
            },
            c => {
                toks.push(Tok::Lit(c));
                i += 1;
            }
        }
    }
    toks
}

fn class(chars: &[char], open: usize) -> Option<(Tok, usize)> {
    let mut j = open + 1;
    let negated = matches!(chars.get(j), Some('!' | '^'));
    if negated {
        j += 1;
    }
    let start = j;
    let mut items = Vec::new();
    while j < chars.len() {
        let c = chars[j];
        if c == ']' && j > start {
            return Some((Tok::Class(negated, items), j + 1));
        }
        if j + 2 < chars.len() && chars[j + 1] == '-' && chars[j + 2] != ']' {
            items.push((c, chars[j + 2]));
            j += 3;
        } else {
            items.push((c, c));
            j += 1;
        }
    }
    None
}

fn single(tok: &Tok, c: char) -> bool {
    match tok {
        Tok::Any => true,
        Tok::Lit(l) => *l == c,
        Tok::Class(negated, items) => items.iter().any(|(lo, hi)| *lo <= c && c <= *hi) != *negated,
        Tok::Star => false,
    }
}

pub fn matches(pattern: &str, text: &str) -> bool {
    let toks = tokenize(pattern);
    let text: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < text.len() {
        if let Some(tok) = toks.get(pi) {
            if matches!(tok, Tok::Star) {
                star = Some((pi + 1, ti));
                pi += 1;
                continue;
            }
            if single(tok, text[ti]) {
                pi += 1;
                ti += 1;
                continue;
            }
        }
        match star {
            Some((after, mark)) => {
                star = Some((after, mark + 1));
                pi = after;
                ti = mark + 1;
            }
            None => return false,
        }
    }
    while matches!(toks.get(pi), Some(Tok::Star)) {
        pi += 1;
    }
    pi == toks.len()
}

#[cfg(test)]
mod tests {
    use super::matches;

    #[test]
    fn star_spans_slashes() {
        assert!(matches("pending/*", "pending/main/a1"));
        assert!(matches("*", ""));
        assert!(!matches("pending/*", "merge/main/a1"));
    }

    #[test]
    fn question_and_classes() {
        assert!(matches("a?c", "abc"));
        assert!(matches("a[b-d]c", "acc"));
        assert!(matches("a[!b]c", "axc"));
        assert!(!matches("a[!b]c", "abc"));
        assert!(matches("a[]]c", "a]c"));
        assert!(matches("a[b", "a[b"));
    }

    #[test]
    fn whole_name_and_case() {
        assert!(!matches("main", "main2"));
        assert!(!matches("Main", "main"));
        assert!(matches("*a*b*", "xxaxxbxx"));
    }
}
