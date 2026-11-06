<p align="center">
  <img src="apps/mobile/assets/images/icon.png" width="96" alt="Vibuzz" />
</p>

<h1 align="center">Vibuzz</h1>
<p align="center"><b>Create. Connect. Remember.</b><br/>Personagens com IA, memória permanente e comunidade — Android, iOS e web.</p>

---

O Vibuzz é uma plataforma onde qualquer pessoa cria personagens, conversa com eles e com criações da comunidade. O diferencial é a **qualidade da interação**: personalidade consistente, memória de longo prazo por conversa, continuidade narrativa (local, objetos, objetivos), grupos com vários integrantes que falam como indivíduos diferentes, e visão para imagens.

## O que tem

| Área | Recursos |
|---|---|
| **Criação** | Ficha estruturada completa (20 campos), criação manual, **com IA** (ideia + imagens), análise de imagem que distingue 1 pessoa / várias / cenário / sem referência / ambígua e pergunta qual pessoa usar, regenerar campo a campo, **versões** com prévia de mudanças e restauração, grupos de 2–8 integrantes |
| **Chat** | Streaming, imagens (com visão), regenerar, continuar, editar (nova ramificação ou substituir), apagar (do histórico ou definitivo), **ramificações** navegáveis ‹ 1/3 ›, fixar, favoritar, arquivar, pesquisa no histórico, troca de persona, criatividade |
| **Motor de IA** | Vibuzz Intelligence Engine: identidade + persona + memórias + cena + relações + resumos + histórico, com prompt cacheável, proteção contra prompt injection, 3 níveis (rápido/avançado/especializado), fallback entre provedores, controle de custo e latência |
| **Memória** | 7 categorias, consolidação assíncrona (extrai → deduplica → atualiza → salva com mensagens de origem), busca híbrida (semântica pgvector + palavras-chave + importância + recência), resumos incrementais, memória **por ramificação**, invalidação/reconstrução ao apagar mensagens, tela para ver/corrigir/apagar |
| **Grupos** | Orquestrador decide quem fala, quem fica quieto, reações e discordâncias; memória individual + coletiva; **mensagens privadas** para um integrante que os outros não sabem |
| **Personas** | Várias identidades fictícias, padrão, duplicar, trocar no meio da conversa — separadas da conta real |
| **Comunidade** | Descobrir (busca por nome/descrição/@criador/#tag, categorias, filtros, 5 ordenações), recomendações personalizadas (gosto + embeddings + seguidos), curtir, favoritar, avaliar, comentar, seguir, compartilhar link, público/por link/privado |
| **Segurança** | RLS em todas as tabelas, chaves só no servidor, idade mínima 13, conteúdo 18+ só para adultos que optarem, regras para personagens menores, moderação de texto e imagem, denúncias, bloqueio, limites diários e por minuto, exclusão de conta e dados (LGPD) |

## Estrutura

```
apps/mobile      App Expo (React Native + TypeScript, Expo Router) — Android, iOS, web
apps/api         API Node/TypeScript (Fastify): motor de IA, memória, visão, moderação, fila
packages/shared  Esquemas zod e tipos compartilhados
supabase/        Migrations SQL (schema, RLS, funções, storage) — aplicadas no projeto Supabase "Vibuzz"
scripts/         Validação das migrations (PGlite + pgvector) e geração de ícones
docs/            Setup, arquitetura, status, termos, privacidade, especificação
```

## Começar

Guia completo: **[docs/SETUP.md](docs/SETUP.md)**. Resumo:

```bash
npm install
# 1. Banco: crie um projeto Supabase e aplique supabase/migrations (supabase db push)
# 2. API
cp apps/api/.env.example apps/api/.env      # SUPABASE_URL, SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
npm run dev:api
# 3. App
cp apps/mobile/.env.example apps/mobile/.env  # URL + anon key + URL da API
npm run dev:mobile
```

## Verificar

```bash
npm run check   # typecheck de tudo + testes da API + migrations/RLS em Postgres embutido
```

O CI do GitHub (`.github/workflows/ci.yml`) roda isso e ainda compila a API e exporta o app web.

## Documentação

- [docs/SETUP.md](docs/SETUP.md) — contas, chaves, deploy da API, builds do app, publicação nas lojas
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — como o motor de IA, a memória e os grupos funcionam
- [docs/STATUS.md](docs/STATUS.md) — o que está pronto, pendências, decisões técnicas, banco, testes
- [docs/SPEC.md](docs/SPEC.md) — especificação original do produto
- [docs/TERMS.md](docs/TERMS.md) · [docs/PRIVACY.md](docs/PRIVACY.md)
