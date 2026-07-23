//! Error and diagnostic types for the code generator.
//!
//! Fallible operations return [`Error`].
//! Code-generation problems are aggregated: [`CodeGenerator::generate`](crate::CodeGenerator::generate)
//! validates everything it can and reports all [`Diagnostic`]s at once in [`Error::Codegen`].

use std::fmt;
use std::path::PathBuf;

/// Top-level error type for the code generator.
#[derive(Debug)]
pub enum Error {
    /// An I/O error while reading sources or writing output.
    Io(std::io::Error),
    /// A Rust source file (or string) failed to parse.
    Parse {
        /// The file that failed to parse; `None` for
        /// [`add_source_str`](crate::CodeGenerator::add_source_str).
        file: Option<PathBuf>,
        /// The underlying parse error.
        source: syn::Error,
    },
    /// One or more code-generation diagnostics, aggregated.
    Codegen(Vec<Diagnostic>),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(err) => write!(f, "I/O error: {err}"),
            Error::Parse { file, source } => {
                let start = source.span().start();
                match file {
                    Some(path) => write!(
                        f,
                        "failed to parse {}:{}:{}: {source}",
                        path.display(),
                        start.line,
                        start.column + 1,
                    ),
                    None => write!(
                        f,
                        "failed to parse source at {}:{}: {source}",
                        start.line,
                        start.column + 1,
                    ),
                }
            }
            Error::Codegen(diagnostics) => {
                writeln!(
                    f,
                    "code generation failed with {} error{}:",
                    diagnostics.len(),
                    if diagnostics.len() == 1 { "" } else { "s" },
                )?;
                for diagnostic in diagnostics {
                    writeln!(f, "  - {diagnostic}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Io(err) => Some(err),
            Error::Parse { source, .. } => Some(source),
            Error::Codegen(_) => None,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error::Io(err)
    }
}

/// A single code-generation problem with optional provenance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// What went wrong.
    pub kind: DiagnosticKind,
    /// The `Type.field` (or `Enum::Variant.field`) that triggered the
    /// diagnostic, when known.
    pub referenced_by: Option<String>,
    /// Where in the source the offending item lives, when known.
    pub location: Option<SourceLocation>,
}

impl Diagnostic {
    /// Create a diagnostic with no provenance.
    pub fn new(kind: DiagnosticKind) -> Self {
        Self {
            kind,
            referenced_by: None,
            location: None,
        }
    }

    /// Attach the referencing `Type.field` context.
    pub fn referenced_by(mut self, context: impl Into<String>) -> Self {
        self.referenced_by = Some(context.into());
        self
    }

    /// Attach a source location.
    pub fn at(mut self, location: Option<SourceLocation>) -> Self {
        self.location = location;
        self
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.kind)?;
        if let Some(referenced_by) = &self.referenced_by {
            write!(f, " (in `{referenced_by}`)")?;
        }
        if let Some(location) = &self.location {
            write!(f, " at {location}")?;
        }
        Ok(())
    }
}

/// The kinds of code-generation diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiagnosticKind {
    /// A fully-qualified Rust type path with no registry mapping.
    UnknownType {
        /// The unresolved path (e.g. `chrono::NaiveDate`).
        rust_path: String,
        /// A registered path sharing the last segment, if any.
        suggestion: Option<String>,
    },
    /// A `#[rkyv(with = ...)]` wrapper with no registered handler.
    UnknownWithWrapper {
        /// The unresolved wrapper path.
        wrapper_path: String,
    },
    /// A registered generic type instantiated with the wrong number of type
    /// arguments.
    GenericArity {
        /// The registered path.
        rust_path: String,
        /// The arity the registration expects.
        expected: usize,
        /// The number of type arguments found at the use site.
        found: usize,
    },
    /// A [`CodecExpr::TypeRef`](crate::CodecExpr::TypeRef) that does not
    /// resolve to any added type.
    UnresolvedTypeRef {
        /// The Rust name that was referenced.
        name: String,
    },
    /// A [`set_archived_name`](crate::CodeGenerator::set_archived_name)
    /// target that never materialized.
    UnknownRenameTarget {
        /// The type name the rename targeted.
        type_name: String,
    },
    /// The same type name added more than once.
    DuplicateType {
        /// The duplicated name.
        name: String,
    },
    /// The same export name imported from two different modules.
    ImportConflict {
        /// The conflicting export name.
        export: String,
        /// The modules it is imported from.
        modules: Vec<String>,
    },
    /// A Rust field type the generator cannot map to a codec.
    UnsupportedFieldType {
        /// The field type, printed as Rust source.
        rust_type: String,
    },
}

impl fmt::Display for DiagnosticKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DiagnosticKind::UnknownType {
                rust_path,
                suggestion,
            } => {
                write!(
                    f,
                    "unknown type `{rust_path}`; register a codec for it with \
                     `register_external(\"{rust_path}\", ...)`"
                )?;
                if let Some(suggestion) = suggestion {
                    write!(f, " (did you mean `{suggestion}`?)")?;
                }
                Ok(())
            }
            DiagnosticKind::UnknownWithWrapper { wrapper_path } => write!(
                f,
                "unknown `#[rkyv(with = ...)]` wrapper `{wrapper_path}`; register it with \
                 `register_with(\"{wrapper_path}\", ...)`"
            ),
            DiagnosticKind::GenericArity {
                rust_path,
                expected,
                found,
            } => write!(
                f,
                "`{rust_path}` expects {expected} type argument{}, found {found}",
                if *expected == 1 { "" } else { "s" },
            ),
            DiagnosticKind::UnresolvedTypeRef { name } => write!(
                f,
                "unresolved type reference `{name}`; no type with that name was added to \
                 the generator"
            ),
            DiagnosticKind::UnknownRenameTarget { type_name } => write!(
                f,
                "`set_archived_name` targets `{type_name}`, but no type with that name was \
                 added to the generator"
            ),
            DiagnosticKind::DuplicateType { name } => {
                write!(f, "type `{name}` is defined more than once")
            }
            DiagnosticKind::ImportConflict { export, modules } => write!(
                f,
                "export `{export}` is imported from multiple modules: {}",
                modules.join(", "),
            ),
            DiagnosticKind::UnsupportedFieldType { rust_type } => write!(
                f,
                "unsupported field type `{rust_type}`; only types mappable to rkyv-js \
                 codecs are supported"
            ),
        }
    }
}

/// A position in a parsed source file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLocation {
    /// The source file; `None` for sources added from strings.
    pub file: Option<PathBuf>,
    /// 1-based line number.
    pub line: usize,
    /// 1-based column number.
    pub column: usize,
}

impl fmt::Display for SourceLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.file {
            Some(file) => write!(f, "{}:{}:{}", file.display(), self.line, self.column),
            None => write!(f, "<source>:{}:{}", self.line, self.column),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_display_includes_context() {
        let diagnostic = Diagnostic::new(DiagnosticKind::UnknownType {
            rust_path: "chrono::NaiveDate".to_string(),
            suggestion: None,
        })
        .referenced_by("Event.date")
        .at(Some(SourceLocation {
            file: Some(PathBuf::from("src/lib.rs")),
            line: 12,
            column: 5,
        }));
        let text = diagnostic.to_string();
        assert!(text.contains("unknown type `chrono::NaiveDate`"));
        assert!(text.contains("(in `Event.date`)"));
        assert!(text.contains("at src/lib.rs:12:5"));
    }

    #[test]
    fn suggestion_is_rendered() {
        let kind = DiagnosticKind::UnknownType {
            rust_path: "collections::HashMap".to_string(),
            suggestion: Some("std::collections::HashMap".to_string()),
        };
        assert!(kind.to_string().contains("did you mean `std::collections::HashMap`?"));
    }

    #[test]
    fn codegen_error_aggregates() {
        let error = Error::Codegen(vec![
            Diagnostic::new(DiagnosticKind::DuplicateType {
                name: "Point".to_string(),
            }),
            Diagnostic::new(DiagnosticKind::UnresolvedTypeRef {
                name: "Missing".to_string(),
            }),
        ]);
        let text = error.to_string();
        assert!(text.contains("2 errors"));
        assert!(text.contains("`Point`"));
        assert!(text.contains("`Missing`"));
    }
}
