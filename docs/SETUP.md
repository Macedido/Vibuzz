# Setup e lançamento

Tudo o que precisa ser configurado fora do código. Nenhuma credencial vem no repositório.

## 0. Requisitos

| O quê | Para quê | Obrigatório |
|---|---|---|
| Node.js 22+ e npm | rodar tudo | sim |
| Conta [Supabase](https://supabase.com) | banco Postgres + pgvector, login, arquivos | sim |
| Chave [Anthropic](https://console.anthropic.com) | chat, criação com IA, visão, memória | sim (ou outro provedor de chat) |
| Chave [OpenAI](https://platform.openai.com) | embeddings (memória semântica) e moderação | recomendado |
| Conta [Expo](https://expo.dev) + `eas-cli` | builds Android/iOS | para as lojas |
| Hospedagem da API (Render, Railway, Fly…) | servidor da IA | para produção |
| Google Play Console / Apple Developer | publicar | para as lojas |

Sem OpenAI o app funciona: a memória usa só busca por palavras-chave e a moderação usa o modelo de chat. Qualquer API compatível com OpenAI (OpenRouter, Groq, Together, Gemini) também serve — veja `COMPAT_*` em `apps/api/.env.example`.

## 1. Instalar

```bash
git clone <seu-repo> vibuzz && cd vibuzz
npm install
npm run check        # typecheck + testes + migrations (não precisa de chaves)
```

## 2. Banco (Supabase)

1. Crie um projeto no Supabase (região mais perto dos usuários, ex.: São Paulo).
2. Aplique as migrations **em ordem** (`supabase/migrations/*.sql`). Duas formas:
   - CLI: `npx supabase login` → `npx supabase link --project-ref <ref>` → `npx supabase db push`
   - Ou cole cada arquivo, em ordem, no **SQL Editor** do painel.
   
   Elas criam extensões (`vector`, `pg_trgm`, `unaccent`), tabelas, RLS, funções, gatilhos, categorias e os buckets `media` (público) e `chat` (privado).
3. **Authentication → URL Configuration**
   - Site URL: `vibuzz://` (ou o domínio da versão web)
   - Redirect URLs: `vibuzz://**`, `exp://**` (desenvolvimento) e `https://seu-dominio/**` (web)
4. **Authentication → Providers → Email**: deixe “Confirm email” ligado.
5. **Produção:** configure um SMTP próprio (Resend, Postmark, SES) em *Authentication → SMTP* — o e-mail padrão do Supabase tem limite baixo de envios.
6. Copie de *Project Settings → API*: `Project URL`, a chave **anon/publishable** (vai no app) e a **service_role/secret** (só na API).

## 3. API (`apps/api`)

```bash
cp apps/api/.env.example apps/api/.env
# preencha SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY e (recomendado) OPENAI_API_KEY
npm run dev:api
curl localhost:8787/v1/status     # mostra o que está configurado e o que falta
```

A API também roda o **worker** (memória, resumos, cena, embeddings, limpeza). Para separar, rode uma instância com `WORKER_ENABLED=false` (web) e outra com `true`; a fila usa `SKIP LOCKED`, então várias instâncias são seguras.

### Testar a qualidade da IA

```bash
npm run eval -w @vibuzz/api     # 9 cenários reais: personalidade, memória, cena, persona, injection, segurança, grupos
```

### Deploy

- **Render:** *New → Blueprint* apontando para o repositório (usa `render.yaml`) e preencha as variáveis secretas.
- **Qualquer Docker:** `docker build -f apps/api/Dockerfile -t vibuzz-api .` na raiz.
- Exponha HTTPS. Streaming usa Server-Sent Events: se houver proxy (Nginx), desligue buffering (`proxy_buffering off`).
- Em produção defina `CORS_ORIGINS` com o domínio da versão web.
- Opcional: `REDIS_URL` para limites de requisição compartilhados entre instâncias.

## 4. App (`apps/mobile`)

```bash
cp apps/mobile/.env.example apps/mobile/.env
# EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_API_URL
npm run dev:mobile
```

- Celular com **Expo Go** na mesma rede: use o IP do computador em `EXPO_PUBLIC_API_URL` (ex.: `http://192.168.0.10:8787`).
- Só valores públicos vão no `.env` do app (eles são embutidos no app). **Nunca** coloque a service_role ou chaves de IA ali.

### Web

```bash
npm run build:web -w @vibuzz/mobile     # gera apps/mobile/dist (site estático)
```
Publique `dist/` em Vercel, Netlify ou Cloudflare Pages com fallback de SPA para `index.html`.

### Android e iOS (EAS)

```bash
npm i -g eas-cli
cd apps/mobile
eas login
eas init                                  # cria o projectId no app.json
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://... --environment production
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value ... --environment production
eas env:create --name EXPO_PUBLIC_API_URL --value https://api.seudominio.com --environment production
eas build -p android --profile production
eas build -p ios --profile production
eas submit -p android   # / -p ios
```

Identificadores já definidos: `app.vibuzz.mobile` (troque em `app.json` se quiser outro), esquema de link `vibuzz://`.

## 5. Checklist das lojas

- [ ] Política de privacidade publicada em URL pública (conteúdo em `docs/PRIVACY.md`; preencha os dados do responsável).
- [ ] Termos de uso publicados (`docs/TERMS.md`).
- [ ] Exclusão de conta dentro do app — **pronto** (Configurações → Excluir conta). Google também pede um link web para pedir exclusão: aponte para uma página com instruções.
- [ ] Conteúdo gerado por usuário: denúncia, bloqueio e moderação — **prontos**. Informe isso nos questionários.
- [ ] Classificação etária: app de chat com IA e conteúdo de usuários (sugestão: 12+/Teen na Play, 17+ na App Store por chat aberto). Conteúdo 18+ fica desligado por padrão e só abre para adultos que optarem.
- [ ] Formulário de segurança de dados (Play) e “App Privacy” (Apple): e-mail, data de nascimento, conteúdo de usuário, fotos, identificadores; dados enviados a provedores de IA para processamento.
- [ ] Ícone e splash — gerados em `apps/mobile/assets/images` (`python3 scripts/make-icons.py` para refazer).
- [ ] Capturas de tela das lojas.

## 6. Operação

- **Denúncias:** tabela `reports` no painel do Supabase. Para remover um personagem: `update characters set status = 'removed', visibility = 'private' where id = '...';`. Para suspender: `update users set status = 'suspended' where id = '...';`. Registre a ação em `moderation_events`.
- **Custos:** tabela `usage_records` (tokens, custo estimado, latência e erros por chamada). Limites por usuário: `DAILY_MESSAGE_LIMIT`, `DAILY_COST_LIMIT_USD`.
- **Fila:** tabela `jobs` (status `failed` com `last_error` mostra problemas do worker).
- **Trocar modelos:** só variáveis de ambiente (`MODEL_FAST/ADVANCED/SPECIALIZED/VISION/EMBEDDING`), sem rebuild do app. Embeddings precisam ter 1536 dimensões (ou ajuste a coluna e `EMBEDDING_DIMENSIONS`).
