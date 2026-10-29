# Uso de IA

## Onde usei

- Usei o Claude Code para escrever código, testes, migrations e documentação.
- Defini os requisitos, a ordem das tarefas e as decisões de produto (em `docs/DECISIONS.md`).
- Escolhi o design: cores, visual e o que aparece em cada tela.
- Usei um agente revisor de IA (`pr-reviewer`) em cada pull request. Ele não substitui a minha revisão.

## Como revisei

- Pedi a saída real dos testes antes de aceitar qualquer resultado.
- Rodei `make ci` e a suíte de navegador antes de cada merge.
- Testei no navegador, no celular e no computador.
- Aprovei cada merge, principalmente de dinheiro, lances, autenticação e migrations.

## Erros da IA que corrigi

- Relatou testes sem a saída real.
- Abriu PR antes da revisão.
- Afirmou segurança sem base.
- Citou referências erradas na documentação.

Peguei esses erros nas revisões, nos testes e na minha conferência, e corrigi antes de seguir.

## O que revisei à mão

Percorri o sistema como cada papel, na tela:

- Como leiloeiro: criei e acompanhei lotes no painel.
- Como licitante 1 e como licitante 2: depositei, dei lances e acompanhei a sala e os arremates.

Revisei o que a IA produziu nesses fluxos, e não só o que os testes cobrem.
