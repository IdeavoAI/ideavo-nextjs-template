# Ideavo Webpack Tagger Findings

## Summary

`@ideavo/webpack-tagger@1.0.1` was configured as a Turbopack loader for every
`.jsx` and `.tsx` file. With Next.js 16.3.3 and Turbopack, requests to `/`
failed with HTTP 500 while processing `src/app/layout.tsx` and
`src/app/page.tsx`.

The immediate cause is the source map returned by the loader. It is generated
without a source filename, producing `"sources": [""]`. Turbopack resolves
that empty source relative to the transformed file, attempts to read the
containing `src/app` directory as source code, and fails with `os error 21`.

The integration is currently disabled in `next.config.ts`. The package remains
installed so it can be re-enabled after a corrected version is published.

## Previous Configuration

The project previously resolved the loader and applied it through a Turbopack
rule:

```ts
import type { NextConfig } from "next";

const loaderPath = require.resolve("@ideavo/webpack-tagger");

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        loaders: [loaderPath],
      },
    },
  },
};
```

The loader parses JSX and TypeScript, adds `ideavo-*` attributes to JSX opening
elements, and returns transformed code with a MagicString source map.

## Observed Failure

The development server started successfully, but `GET /` returned HTTP 500:

```text
./src/app/layout.tsx
Error: Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse:
reading file ".../src/app"

Caused by:
- Is a directory (os error 21)
```

The same error occurred for `src/app/page.tsx`. Once the Turbopack loader rule
was removed, `/` returned HTTP 200 and Next.js MCP's
`get_compilation_issues` reported no issues.

This failure is independent of Cache Components. Restarting the development
server while adopting Cache Components exposed the existing loader problem.

## Confirmed Root Cause

Version 1.0.1 generates its map as follows:

```ts
ms.generateMap({ hires: true });
```

Running that exact MagicString operation produces:

```json
{
  "version": 3,
  "sources": [""],
  "names": [],
  "mappings": "..."
}
```

The empty source entry does not identify the `.tsx` input. Turbopack resolves
it against the input's containing directory. For files in `src/app`, that
becomes `src/app`, which explains why the parser tries to read a directory.

Webpack may tolerate or repair this incomplete map, but Turbopack handles it
strictly enough to expose the invalid source reference.

## Recommended Loader Fix

Generate a complete map that names and embeds the original source:

```ts
import path from "node:path";
import type webpack from "webpack";

function ideavoTaggerLoader(
  this: webpack.LoaderContext<unknown>,
  code: string,
  inputSourceMap?: object,
) {
  const callback = this.async();

  try {
    const ms = transform(code, this.resourcePath);

    if (!ms) {
      callback(null, code, inputSourceMap);
      return;
    }

    const map = ms.generateMap({
      source: this.resourcePath,
      file: path.basename(this.resourcePath),
      includeContent: true,
      hires: true,
    });

    callback(null, ms.toString(), map);
  } catch (error) {
    callback(error as Error);
  }
}
```

The important changes are:

- `source` points to the actual `.jsx` or `.tsx` input.
- `file` identifies the generated file.
- `includeContent: true` embeds the input and avoids source-path inference.
- An unchanged transform preserves `inputSourceMap`.
- A real loader failure is passed to `callback(error)` instead of being hidden
  behind unchanged output.

After generating the map, verify that it resembles:

```json
{
  "sources": ["/project/src/app/page.tsx"],
  "sourcesContent": ["...original source..."]
}
```

`sources` must not contain `""`, `"."`, or a directory such as `src/app`.

## Source-Map Chaining

The loader currently ignores an incoming source map. That can make stack
traces and mappings inaccurate when another transform runs before the tagger.

For full compatibility, accept `inputSourceMap` and compose it with the
MagicString map using a source-map remapping library such as
`@ampproject/remapping`. The output map must trace generated tagger output
through the loader input to the original source. If no transformation occurs,
return the incoming map unchanged.

This chaining issue was not the direct cause of the observed directory crash,
but it should be fixed before treating the loader as production-ready.

## Additional Package Risks

The package metadata has inconsistencies worth correcting:

- The package declares `"type": "module"` and `"main": "dist/index.js"`.
- `dist/index.js` is ESM, while a CommonJS build exists at `dist/index.cjs`.
- `"module"` points to `dist/index.mjs`, but that file is absent from the
  installed package.
- The package only declares Webpack as a peer dependency. Turbopack supports a
  subset of the Webpack loader API, so compatibility should be tested
  explicitly rather than assumed.

Use an explicit exports map so each consumer receives the correct build:

```json
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

These packaging issues did not produce the specific `src/app` directory error,
but they can cause resolution failures in other runtimes and build tools.

## Validation Plan

Before publishing a fixed version:

1. Add a unit test asserting that transformed maps contain the exact resource
   file and include `sourcesContent`.
2. Add a no-op test asserting that unchanged code preserves the incoming map.
3. Add a chaining test with a synthetic incoming source map.
4. Test both ESM import and CommonJS require paths from the published package.
5. Run a Next.js 16.3+ Turbopack fixture containing `.jsx` and `.tsx` routes.
6. Confirm routes return HTTP 200 and `get_compilation_issues` returns no
   issues.
7. Confirm generated elements still contain the expected `ideavo-tag-id`,
   `ideavo-tag-name`, `ideavo-styles-editable`, and
   `ideavo-content-editable` attributes.

## Re-enabling The Tagger

After publishing and installing the corrected package, restore the Turbopack
rule in `next.config.ts`. Prefer package resolution directly in the loader
entry if supported by the tested package version:

```ts
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        condition: { not: "foreign" },
        loaders: [require.resolve("@ideavo/webpack-tagger")],
      },
    },
  },
};
```

Re-enable it only after the HTTP, MCP compilation, source-map, and generated
attribute checks all pass.
