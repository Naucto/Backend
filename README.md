# Naucto Backend

This is the backend for Naucto, a browser fantasy console, developed using [NestJS](https://nestjs.com/), [Prisma](https://www.prisma.io/), and TypeScript.

---

### 📢 Open Source Contribution

This project is open source. You are welcome to contribute on GitHub at the following address:
👉 [https://github.com/Naucto/Backend](https://github.com/Naucto/Backend)

---

### Launch the project

1. Clone the repository

2. Install dependencies

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in the blanks; the object-storage values it carries are the local MinIO defaults.

   ```bash
   cp .env.example .env
   ```

4. Copy the WebRTC configuration template; it carries the connection limit and the ICE servers handed to browsers.

   ```bash
   cp config/webrtc.example.json config/webrtc.json
   ```

5. Start Postgres, MinIO and the API with hot reload; migrations are applied on start.

   ```bash
   ./dev.sh
   ```

6. Optionally seed people, friendships and sessions:

   ```bash
   npm run seed:dev
   ```

---

### 🛠️ Testing 

To run the tests, use the following command:

```bash
npm run test
```

### Generate API for frontend

To generate the API client for the frontend, use the following command:

```bash
npm run client:build       # emit swagger.json, then build @naucto/api-client into client/dist
```

The client is published to GitHub Packages as `@naucto/api-client` by `.github/workflows/api-client.yml`
(see `client/README.md` for install and versioning).

### 🤝 Conventions & project structure

Code conventions, the architecture map, and guidance for both contributors and AI agents live
in [`AGENTS.md`](./AGENTS.md). Commit and branch rules are in [`CONTRIBUTING.md`](./CONTRIBUTING.md),
and the vulnerability disclosure policy is in [`SECURITY.md`](./SECURITY.md).

---

### 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.
