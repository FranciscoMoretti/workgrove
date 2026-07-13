# Shadcn form generators for the Workgrove configuration editor

Research date: 2026-07-13

## Decision

No current generator is a clean drop-in for Workgrove.

The recommended implementation remains a small Workgrove-owned editor built with
the repository's existing shadcn Base UI components, React Hook Form, and the
existing Zod schema. Use schema metadata to remove repetitive scalar-field
boilerplate, but implement `apps`, key/value maps, commands, and launch-mode
selection as explicit domain components.

If adopting a rendering engine is still desirable, the only candidate worth a
bounded prototype is `@rjsf/core` with a Workgrove-owned Base UI theme. Do not use
the published `@rjsf/shadcn` theme directly.

## Workgrove-specific requirements

The persisted configuration is not a conventional flat form. Its defining
shapes are arbitrary-key records:

- `apps: Record<string, WorkgroveApp>`
- app `exports: Record<string, string>`
- command `env: Record<string, string>`

The editor therefore needs add, remove, and rename operations for object keys,
nested object rendering, custom command controls, path-aware cross-field
validation, and exact round-tripping to the existing configuration model.
Workgrove also uses shadcn's Base UI primitive family rather than Radix.

## Candidate matrix

| Candidate | Kind | Zod 4 | Dynamic record keys | Base UI fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Vantezzen AutoForm](https://autoform.vantezzen.io/docs) | Runtime Zod renderer installed partly as shadcn-owned source | Yes | No native `ZodRecord` renderer | Partial; source can be adapted, but current registry code assumes APIs/styles outside Workgrove's conventions | Closest Zod-first option, but not a fit for the core Workgrove data model |
| [RJSF](https://rjsf-team.github.io/react-jsonschema-form/) | Runtime JSON Schema renderer | Via `z.toJSONSchema()` bridge | Yes: native `additionalProperties` add/rename/remove | Core is headless enough; published shadcn theme is Radix-based | Best engine candidate, but only with a custom Base UI theme |
| [shadcn-zod-form](https://github.com/arkemis-labs/shadcn-zod-form) | One-time CLI source generator | No; generator currently depends on Zod 3 | No | Generated templates target conventional shadcn form code | Reject |
| [Formedible](https://github.com/DimitriGilbert/Formedible) | Runtime renderer driven by a separate field list | Accepts a Zod validation schema | Array/object support, but records are not its central model | Source-installed shadcn/TanStack approach | Reject: duplicates the schema in `fields`, and the repository currently has no detected license |
| [Formcn](https://github.com/Ali-Hussein-dev/formcn) | Visual, one-time code generator | Generates Zod form code | Intended for designed form fields, not live arbitrary-key configuration records | Generated source is editable | Useful for scaffolding only; not a maintained schema-to-editor runtime |
| [ZodForm](https://zodform.vercel.app/) | Runtime Zod renderer | Unclear for current Zod 4 usage | Not demonstrated for Workgrove's record-heavy model | No shadcn theme; only custom and Mantine themes are documented | Reject: early API, no releases, and substantial theme work |

## Detailed findings

### Vantezzen AutoForm

AutoForm is actively maintained, supports React 17-19, and its Zod provider
declares support for both Zod 3 and 4. Its shadcn integration installs renderer
source into the application, which is attractive because Workgrove can own and
adapt that code. It also exposes custom field and UI component overrides.
([getting started](https://autoform.vantezzen.io/docs/react/getting-started),
[customization](https://autoform.vantezzen.io/docs/react/customization),
[package metadata](https://github.com/vantezzen/autoform/blob/main/packages/react/package.json))

The blocker is `ZodRecord`. The current Zod 4 parser explicitly recognizes
objects, strings, numbers, booleans, dates, enums, and arrays; unknown types fall
back to a string field. Its schema parser only recurses into `ZodObject` and
`ZodArray`. Consequently the three most important Workgrove collection types do
not receive add/remove/rename key behavior.
([field type inference](https://github.com/vantezzen/autoform/blob/main/packages/zod/src/v4/field-type-inference.ts),
[schema parser](https://github.com/vantezzen/autoform/blob/main/packages/zod/src/v4/schema-parser.ts))

AutoForm could work only by introducing a separate form model that converts all
records to arrays of `{ key, value }` objects. That gives up the original goal of
rendering directly from `WorkgroveConfigSchema` and adds bidirectional adapters
for apps, exports, and environments. AutoForm's own documentation positions it
primarily for simple and internal forms rather than every schema edge case.
([project scope](https://autoform.vantezzen.io/docs))

### React JSON Schema Form (RJSF)

RJSF is the most mature candidate and has the strongest match for the persisted
data. It natively renders JSON Schema objects with `additionalProperties`,
including an add button. Its template and widget APIs expose key rename and
property removal, and arbitrary fields/widgets can be replaced through a
`uiSchema` or registry.
([object/additional properties](https://rjsf-team.github.io/react-jsonschema-form/docs/usage/objects/),
[custom widgets and fields](https://rjsf-team.github.io/react-jsonschema-form/docs/advanced-customization/custom-widgets-fields/),
[custom templates](https://rjsf-team.github.io/react-jsonschema-form/docs/advanced-customization/custom-templates/))

This aligns naturally with the JSON Schema produced by Zod 4. Workgrove would
still run the original Zod schema for authoritative client/server validation,
because JSON Schema generation cannot represent every Zod/runtime refinement.
([Zod JSON Schema conversion](https://zod.dev/json-schema))

The published `@rjsf/shadcn` package is not compatible with Workgrove's design
system boundary. It ships its own component implementations and directly
depends on multiple Radix packages, while Workgrove uses shadcn Base UI. It also
adds RJSF core/utils, AJV, lodash, and its theme dependency tree.
([theme package](https://github.com/rjsf-team/react-jsonschema-form/blob/main/packages/shadcn/package.json),
[supported themes](https://rjsf-team.github.io/react-jsonschema-form/docs/usage/themes/))

The plausible experiment is therefore `@rjsf/core` plus a deliberately small
Workgrove Base UI theme. That reuses RJSF's schema traversal and dynamic-object
state handling while keeping all visible controls inside the local shadcn
boundary. The cost is a second validation engine and a non-trivial template
surface, so it should be compared against the size of a purpose-built renderer
before adoption.

### shadcn-zod-form

This CLI generates ordinary React form source rather than rendering a schema at
runtime. The current package depends on Zod 3. Its parser only detects direct
`z.object(...)` declarations, evaluates their source, and the field generator
supports nested objects plus arrays of objects. Unsupported schema types are
skipped; `ZodRecord` has no handler.
([package](https://github.com/arkemis-labs/shadcn-zod-form/blob/main/package.json),
[schema parser](https://github.com/arkemis-labs/shadcn-zod-form/blob/main/src/utils/parse-zod.ts),
[field generator](https://github.com/arkemis-labs/shadcn-zod-form/blob/main/src/utils/form-fields.ts))

It could produce a disposable first draft, but it would not keep the form in
sync with schema evolution and cannot generate Workgrove's central editors.

### Visual form builders

Formcn and similar browser builders generate source from a separately designed
form. Formcn describes itself as a tool for producing single- or multi-step
shadcn forms and exporting generated code. That is useful when the form design
is the source of truth, but Workgrove already has a versioned persisted schema
that must remain authoritative.
([Formcn project](https://github.com/Ali-Hussein-dev/formcn),
[Formcn site](https://formcn.dev/))

They may be useful for visual inspiration or one-time scaffolding, but should
not become part of the editor architecture.

## Recommended plan adjustment

1. Do not install an online generator as the production editor foundation.
2. Use React Hook Form and the existing Zod schema for values, dirty state, and
   validation.
3. Add Zod `title`/`description` metadata and optionally use the generated JSON
   Schema for repetitive scalar fields only.
4. Implement four explicit Workgrove components: `AppsEditor`,
   `KeyValueEditor`, `CommandEditor`, and `LaunchModeEditor`.
5. Before committing to a home-grown scalar/object traversal layer, run one
   bounded prototype of `@rjsf/core` with local Base UI templates against an
   unchanged real Workgrove configuration. Adopt it only if the prototype can
   render and round-trip all three record shapes without importing
   `@rjsf/shadcn` or weakening Zod validation.

This keeps the difficult, product-defining behavior explicit while still
automating the genuinely repetitive part of the form.
