---
layout: default
title: Start here for engineers
permalink: /engineering/
---

# MC Wallet — Start Here for Engineers

A reading order and two orientation diagrams for people working on the codebase.
It threads the existing docs together and makes the enforced import-layering and
the untrusted-message path legible as pictures, rather than only as scripts. It
does not replace those docs — it points at them.

---

## Reading order

Read these in order before your first change:

1. **[README.md](https://github.com/starknet-innovation/mc-wallet/blob/main/README.md)** — what the wallet is, the feature set, quick
   start, and the offline-runnable check subset.
2. **[AGENTS.md](https://github.com/starknet-innovation/mc-wallet/blob/main/AGENTS.md)** — the operational engineering guide: setup
   commands, the `src/` layout, the hard rules enforced by `bun run check`, and
   the "reuse before writing" anti-drift notes.
3. **[CONTRIBUTING.md](https://github.com/starknet-innovation/mc-wallet/blob/main/CONTRIBUTING.md)** — the binding architecture and
   security rules, the branch/release/PR workflow, and the taste bar.
4. **[docs/ARCHITECTURE.md](../architecture/)** — the deep tour: trust
   boundaries, the pinned account/multisig class hashes, the dApp provider
   surface, storage migrations, and the design system.
5. **[DEVELOPMENT.md](https://github.com/starknet-innovation/mc-wallet/blob/main/DEVELOPMENT.md)** — day-to-day developer workflow.
6. **[docs/security-audit/](../security-audit/)** — threat model, methodology,
   findings, and the directory-by-directory reviews.
7. **[RELEASING.md](https://github.com/starknet-innovation/mc-wallet/blob/main/RELEASING.md)** — how a release is cut and promoted.

For the *why* behind any rule, `CONTRIBUTING.md` and `AGENTS.md` are canonical;
this page only helps you find them.

---

## Module map (import layering)

The `src/` subdirectories form layers with an enforced dependency **direction**.
The rule is codified in
[`scripts/check-import-layers.ts`](https://github.com/starknet-innovation/mc-wallet/blob/main/scripts/check-import-layers.ts) (run
`bun run check:imports`); the diagram below is derived from its
`FORBIDDEN_TARGETS` table. Arrows point in the **allowed** direction — a module
may import from layers below it, never above.

```mermaid
flowchart TD
    subgraph privileged["Privileged worker"]
        background["background<br/><i>approvals, unlock sessions, vault wiring</i>"]
    end
    subgraph edges["Page-side & UI (must NOT import background)"]
        sidepanel["sidepanel"]
        ui["ui"]
        popup["popup"]
        provider["provider"]
        content["content"]
        ledger["ledger-grant"]
    end
    subgraph domain["Domain"]
        wallet["wallet"]
        starknet["starknet"]
        storage["storage"]
    end
    subgraph lowlevel["Low-level (must NOT reach up into page/UI/background)"]
        crypto["crypto<br/><i>Krusty KMS adapter</i>"]
        security["security<br/><i>phishing blocklist</i>"]
    end
    shared["shared<br/><i>leaf — imports no other src/ dir</i>"]

    background --> edges
    background --> domain
    edges --> domain
    domain --> lowlevel
    domain --> shared
    lowlevel --> shared
```

The forbidden edges the gate enforces (from `FORBIDDEN_TARGETS`):

| Layer | Must **not** import from |
| --- | --- |
| `shared` | any other `src/` subdirectory (it is a leaf) |
| `crypto` | `background`, `content`, `ledger-grant`, `popup`, `provider`, `sidepanel`, `ui` |
| `security` | `background`, `content`, `ledger-grant`, `popup`, `provider`, `sidepanel`, `ui` |
| `ui`, `popup`, `sidepanel` | `background` |
| `provider`, `content`, `ledger-grant` | `background` |

`background` has no forbidden targets — it is the privileged layer everything
else feeds into. Run `bun run scripts/check-import-layers.ts --print-edges` to
dump the observed cross-directory edges the rules were derived from.

---

## Data flow: the untrusted message path

A dApp on a web page is **untrusted**. Its request crosses several boundaries
before any key material is touched, and signing/vault operations are never
exposed to the page. The privileged `background` layer validates type, origin,
and capability on every extension message.

```mermaid
flowchart LR
    dapp["dApp page<br/>(untrusted)"]
    inpage["provider/inpage.ts<br/>window.starknet_mcWallet"]
    bridge["provider/bridge.ts<br/>maps methods to safe messages"]
    content["content/index.ts<br/>page ↔ background relay"]
    background["background<br/>validate type / origin / capability"]
    crypto["crypto<br/>Krusty KMS (WASM)"]
    storage["storage<br/>encrypted vault + permissions"]
    sidepanel["sidepanel<br/>user approval UI"]

    dapp -->|"request()"| inpage
    inpage --> bridge
    bridge -->|postMessage| content
    content -->|runtime message| background
    background -->|"approval needed"| sidepanel
    sidepanel -->|"user approves"| background
    background --> crypto
    background --> storage
    background -->|"result only (no keys)"| content
    content --> inpage
    inpage -->|"resolve"| dapp
```

Key invariants (see `docs/ARCHITECTURE.md` §dApp Provider and `AGENTS.md`):

- The page never talks to `background` directly; it only sees
  `window.starknet_mcWallet`. `provider` and `content` are on the untrusted side
  and, per the layering gate, cannot import `background`.
- The dapp-reachable method set is the enforced-derived `DAPP_MESSAGES` allowlist
  in `src/background/senders.ts`; a new dapp-facing method must be added there
  deliberately.
- Krusty KMS owns all wallet crypto. If it is unavailable, the wallet fails
  closed — there is no local signing fallback.
- Secret-material field names may appear only in the boundary modules whitelisted
  in `scripts/check-file-standards.ts`.
