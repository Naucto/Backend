# EIP Backend

This is the backend for the EIP project, developed using [NestJS](https://nestjs.com/), [Prisma](https://www.prisma.io/), and TypeScript.

---

### 📢 Open Source Contribution

This project is open source. You are welcome to contribute on GitHub at the following address:
👉 [https://github.com/Naucto/Backend](https://github.com/Naucto/Backend)

---

### 📁 Project Structure

- `src/auth` : JWT authentication, roles, guards, strategy
- `src/routes/user` : User management
- `src/routes/project` : Project management
- `src/routes/work-session` : Work session management
- `src/routes/aws` : AWS S3 integration (upload, buckets, policies)
- `src/aws` : Shared AWS logic
- `src/common` : Common DTOs and decorators
- `src/prisma` : Prisma service and module configuration
- `prisma/schema.prisma` : Data model definition

---

### 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.
