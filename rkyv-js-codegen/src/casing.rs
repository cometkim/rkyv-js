//! Identifier casing conversion for emitted field and variant names.
//!
//! Rust spells struct fields `snake_case`; JavaScript spells them `camelCase`.
//! Because rkyv lays a struct out positionally, the keys of the emitted `r.struct({ ... })` are labels only;
//! renaming them changes the shape of the decoded JavaScript object without touching a single wire byte.

/// The identifier casing of emitted field and variant names.
///
/// Configured through [`set_field_casing`](crate::CodeGenerator::set_field_casing)
/// and [`set_variant_casing`](crate::CodeGenerator::set_variant_casing).
///
/// ```
/// use rkyv_js_codegen::Casing;
///
/// assert_eq!(Casing::Camel.apply("created_at"), "createdAt");
/// assert_eq!(Casing::Camel.apply("HTTP_status"), "httpStatus");
/// assert_eq!(Casing::Pascal.apply("created_at"), "CreatedAt");
/// assert_eq!(Casing::Snake.apply("createdAt"), "created_at");
/// assert_eq!(Casing::Preserve.apply("created_at"), "created_at");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Casing {
    /// Emit the Rust name verbatim.
    #[default]
    Preserve,
    /// `created_at` -> `createdAt`.
    Camel,
    /// `created_at` -> `CreatedAt`.
    Pascal,
    /// `createdAt` -> `created_at`.
    Snake,
}

impl Casing {
    /// Convert an identifier to this casing.
    ///
    /// Leading underscores are preserved (`_private` -> `_private`),
    /// and a name that carries no word characters at all (`_`, `__`) is returned unchanged.
    pub fn apply(self, name: &str) -> String {
        if self == Casing::Preserve {
            return name.to_string();
        }

        let trimmed = name.trim_start_matches('_');
        let prefix = &name[..name.len() - trimmed.len()];
        let words = split_words(trimmed);
        if words.is_empty() {
            return name.to_string();
        }

        let mut out = String::with_capacity(name.len() + prefix.len());
        out.push_str(prefix);
        match self {
            Casing::Preserve => unreachable!("handled above"),
            Casing::Camel => {
                for (index, word) in words.iter().enumerate() {
                    if index == 0 {
                        out.push_str(&word.to_lowercase());
                    } else {
                        push_capitalized(&mut out, word);
                    }
                }
            }
            Casing::Pascal => {
                for word in &words {
                    push_capitalized(&mut out, word);
                }
            }
            Casing::Snake => {
                for (index, word) in words.iter().enumerate() {
                    if index > 0 {
                        out.push('_');
                    }
                    out.push_str(&word.to_lowercase());
                }
            }
        }
        out
    }
}

fn push_capitalized(out: &mut String, word: &str) {
    let mut chars = word.chars();
    let Some(first) = chars.next() else {
        return;
    };
    out.extend(first.to_uppercase());
    out.push_str(&chars.as_str().to_lowercase());
}

/// Split an identifier into words on underscores and case boundaries.
///
/// An uppercase run is kept together as one word (`HTTPStatus` -> `HTTP`, `Status`),
/// so acronyms survive the round trip through any casing.
fn split_words(name: &str) -> Vec<String> {
    let chars: Vec<char> = name.chars().collect();
    let mut words = Vec::new();
    let mut current = String::new();

    for (index, &ch) in chars.iter().enumerate() {
        if ch == '_' {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }
        if ch.is_uppercase() && !current.is_empty() {
            let previous = chars[index - 1];
            let next_is_lower = chars.get(index + 1).is_some_and(|next| next.is_lowercase());
            // `fooBar` → boundary before `B`; `HTTPStatus` → boundary before
            // `S` only because `t` follows it.
            if !previous.is_uppercase() || next_is_lower {
                words.push(std::mem::take(&mut current));
            }
        }
        current.push(ch);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserve_is_the_identity() {
        for name in ["created_at", "createdAt", "HTTPStatus", "_private", "__"] {
            assert_eq!(Casing::Preserve.apply(name), name);
        }
    }

    #[test]
    fn camel_case_conversion() {
        assert_eq!(Casing::Camel.apply("created_at"), "createdAt");
        assert_eq!(Casing::Camel.apply("id"), "id");
        assert_eq!(Casing::Camel.apply("a_b_c"), "aBC");
        assert_eq!(Casing::Camel.apply("already_Mixed"), "alreadyMixed");
        assert_eq!(Casing::Camel.apply("createdAt"), "createdAt");
        assert_eq!(Casing::Camel.apply("CreatedAt"), "createdAt");
    }

    #[test]
    fn pascal_case_conversion() {
        assert_eq!(Casing::Pascal.apply("created_at"), "CreatedAt");
        assert_eq!(Casing::Pascal.apply("createdAt"), "CreatedAt");
        assert_eq!(Casing::Pascal.apply("CreatedAt"), "CreatedAt");
    }

    #[test]
    fn snake_case_conversion() {
        assert_eq!(Casing::Snake.apply("createdAt"), "created_at");
        assert_eq!(Casing::Snake.apply("CreatedAt"), "created_at");
        assert_eq!(Casing::Snake.apply("created_at"), "created_at");
    }

    #[test]
    fn acronyms_stay_whole() {
        assert_eq!(Casing::Camel.apply("HTTP_status"), "httpStatus");
        assert_eq!(Casing::Camel.apply("HTTPStatus"), "httpStatus");
        assert_eq!(Casing::Camel.apply("user_ID"), "userId");
        assert_eq!(Casing::Snake.apply("HTTPStatus"), "http_status");
        assert_eq!(Casing::Pascal.apply("http_status"), "HttpStatus");
    }

    #[test]
    fn digits_join_the_preceding_word() {
        assert_eq!(Casing::Camel.apply("field_2"), "field2");
        assert_eq!(Casing::Camel.apply("x2_y3"), "x2Y3");
        assert_eq!(Casing::Snake.apply("field2"), "field2");
    }

    #[test]
    fn leading_underscores_are_preserved() {
        assert_eq!(Casing::Camel.apply("_private_field"), "_privateField");
        assert_eq!(Casing::Snake.apply("__internalValue"), "__internal_value");
        // No word characters at all: nothing sensible to convert.
        assert_eq!(Casing::Camel.apply("_"), "_");
        assert_eq!(Casing::Camel.apply("___"), "___");
    }

    #[test]
    fn trailing_underscores_are_dropped() {
        // A trailing `_` carries no word; keeping it would be the only way a
        // conversion could emit two different identifiers for one word.
        assert_eq!(Casing::Camel.apply("type_"), "type");
        assert_eq!(Casing::Snake.apply("type_"), "type");
    }
}
