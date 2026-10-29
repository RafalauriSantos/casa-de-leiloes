# Onde e como a IA foi usada

O formulário de envio pergunta onde e como a IA foi usada, e o que foi revisado ou ajustado. Este arquivo responde a partir
do que o repositório mostra (B22).

## Onde

- **Código, testes, migrations, documentação e mensagens de commit:** escritos por um agente de IA de código (Claude Code),
  em sessões dirigidas pelo dono do projeto (Rafael Lauri). Os commits levam o nome do dono porque foram feitos da máquina
  e da conta dele; quase todo o conteúdo foi produzido pelo agente.
- **Análise e design:** o agente redigiu a leitura do enunciado, as jornadas com seus critérios de aceite
  (`docs/TRACEABILITY.md`) e as decisões de design (`docs/DECISIONS.md`). O dono aprovou cada fase antes da seguinte e
  tomou as decisões de produto (abaixo).
- **Revisões:** um agente revisor de IA, `pr-reviewer`, configurado nas configurações locais do dono (fora deste repositório).
  Ele lê o diff final de cada pull request, em contexto limpo, e devolve PASS ou FAIL. Os achados são revisões de IA, não
  humanas.

## Como (as travas em volta do agente)

- Um teste primeiro, visto falhando pelo motivo certo, e só depois o código. Postgres real, Supabase Auth real, HTTP real e
  relógio real; só o acervo do Met e a âncora do GitHub são servidos de respostas gravadas no CI.
- `make ci` (lint, tipos, build, testes com cobertura, auditoria de dependências) é a única definição de verde, local e no CI.
- Para regras de alto risco, uma mutação manual: a regra é quebrada de propósito e um teste precisa falhar (exemplos em D24 e D25).
- Dinheiro, lances, liquidação, autenticação, permissões e migrations só entram depois que o dono escreve "pode mergear"
  para aquele pull request.

## O que o dono decidiu

As decisões marcadas como "decidida pelo dono" ou "o dono escolheu" em `docs/DECISIONS.md`, entre elas: a âncora pública
com a liquidação esperando a publicação (D21, opção B), a ausência de releitura da âncora antes do pagamento, a liberação de
lote adulterado pelo dono (D20), o limite de 1.000 lances por lote (D23), a senha compartilhada de demonstração (D9c), a
escolha do papel no cadastro (D24) e o escopo dos opcionais do enunciado (B19 a B21).

## Saídas da IA que estavam erradas e foram corrigidas

Exemplos que o histórico mostra:

- A primeira regra de anti-sniping não seguia o enunciado; foi trocada por "um lance tardio estende o fim em dois minutos"
  (PR #7).
- A auditoria não percebia a alteração de um horário de lance mais fino que o milissegundo (PR #19).
- Os cards vitrine mostravam o lance inicial mesmo depois de haver lances (PR #42).
- Um teste da seed passava só em banco novo e falhava na execução local seguinte (B13).
- Em 26/10/2026, uma sessão começou confirmação de e-mail e recuperação de senha, que o enunciado não pede (ele lista a
  recuperação de senha em "não precisa fazer"). O dono mandou conferir o trabalho com o enunciado, e ele foi descartado
  antes de qualquer commit.

## O que o dono revisou à mão

<!-- A ser escrito pelo dono antes do envio: quais mudanças o dono leu, executou ou testou à mão. Não preenchido pelo agente. -->

## Registro escrito pelo dono

Texto escrito pelo dono do projeto, sem edição:

Uso de IA no projeto Casa de Leilões

Usei IA no desenvolvimento inteiro. Eu definia os requisitos e a ordem das tarefas pela importância, e delegava cada parte a subagentes. A IA escrevia o código, os testes e a documentação, e fazia as auditorias e as revisões. Eu conferia cada resultado: pedia a saída real dos testes, mandava refazer o que não batia com os requisitos, aprovava cada merge e cada ação que mexia em dados ou permissões.

Os processos do projeto, como testar antes de corrigir e revisar cada PR de forma independente, existiram porque a primeira resposta da IA nem sempre estava certa. Ela errou em alguns pontos, como relatar testes sem saída real, abrir PR antes da revisão e afirmar uma segurança que não se sustentava. Esses erros foram pegos nas revisões e nas minhas medições.

Não revisei cada linha gerada. Revisei o que os testes, as revisões e as medições no navegador mostraram.
