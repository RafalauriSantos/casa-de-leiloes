# Where and how AI was used

The submission form asks where and how AI was used, and what was reviewed or adjusted. This file answers from what the
repository shows (B22).

## Where

- **Code, tests, migrations, docs and commit messages:** written by an AI coding agent (Claude Code), in sessions the
  owner (Rafael Lauri) directed. The commits carry the owner's name because they were made from the owner's machine
  and account; nearly all of their content was produced by the agent.
- **Analysis and design:** the agent drafted the reading of the brief, the user journeys with their acceptance criteria
  (`docs/TRACEABILITY.md`) and the design decisions (`docs/DECISIONS.md`). The owner approved each phase before the next
  one started, and took the product decisions (below).
- **Reviews:** two reviewer agents, also AI, set up in the owner's local agent settings (not in this repository): `pr-reviewer` reads the final diff of every
  pull request; `blind-reviewer` gets only the branch and its base, with no description of the change, and is used for
  money, bids, settlement, authentication, permissions and migrations. Their findings are AI reviews, not human ones.

## How (the guard rails around the agent)

- A test first, seen failing for the right reason, then the code. Real Postgres, real Supabase Auth, real HTTP and real
  clocks; only the Met catalog and the GitHub anchor are served from recorded answers in CI.
- `make ci` (lint, types, build, tests with coverage, dependency audit) is the only definition of green, locally and in CI.
- For high-risk rules, a hand mutation: the rule is broken on purpose and a test must fail (examples in D24 and D25).
- Money, bids, settlement, authentication, permissions and migrations merge only after the owner writes "pode mergear"
  for that pull request.

## What the owner decided

The decisions marked "decided by the owner" or "the owner chose" in `docs/DECISIONS.md`, among them: the public anchor
with the settlement waiting for publication (D21, option B), no read-back of the anchor before payment, the owner's
release of a tampered lot (D20), the limit of 1,000 bids per lot (D23), the shared demo password (D9c), the sign-up
choosing the role (D24) and the scope of the optionals of the brief (B19 to B21).

## AI output that was wrong and was corrected

Examples the history shows:

- The first anti-sniping rule did not follow the brief; it was changed to "a late bid extends the end by two minutes"
  (PR #7).
- The audit missed a change of a stored bid time finer than a millisecond (PR #19).
- Showcase cards showed the starting bid even after bids (PR #42).
- A seed test passed only on a fresh database and failed on the next local run (B13).
- On 2026-10-26 a session began e-mail confirmation and password recovery, which the brief does not ask for (it lists
  password recovery under "não precisa fazer"). The owner had the work checked against the brief, and it was dropped
  before any commit.

## What the owner reviewed by hand

<!-- To be written by the owner before submitting: which changes the owner read, ran or tested by hand. Not filled in by the agent. -->

## Registro escrito pelo dono

Texto escrito pelo dono do projeto, sem edição:

Uso de IA no projeto Casa de Leilões

Usei IA no desenvolvimento inteiro. Eu definia os requisitos e a ordem das tarefas pela importância, e delegava cada parte a subagentes. A IA escrevia o código, os testes e a documentação, e fazia as auditorias e as revisões. Eu conferia cada resultado: pedia a saída real dos testes, mandava refazer o que não batia com os requisitos, aprovava cada merge e cada ação que mexia em dados ou permissões.

Os processos do projeto, como testar antes de corrigir e revisar cada PR de forma independente, existiram porque a primeira resposta da IA nem sempre estava certa. Ela errou em alguns pontos, como relatar testes sem saída real, abrir PR antes da revisão e afirmar uma segurança que não se sustentava. Esses erros foram pegos nas revisões e nas minhas medições.

Não revisei cada linha gerada. Revisei o que os testes, as revisões e as medições no navegador mostraram.
