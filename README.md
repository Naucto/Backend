# EIP Backend

This is the backend for the EIP project, developed using [NestJS](https://nestjs.com/), [Prisma](https://www.prisma.io/), and TypeScript.

---

### 📢 Open Source Contribution

This project is open source. You are welcome to contribute on GitHub at the following address:
👉 [https://github.com/Naucto/Backend](https://github.com/Naucto/Backend)

---

### Launch the project

1. Clone the repository

2. Install dependencies

   ```bash
   yarn install
   ```

3. Create a `.env` file in the root directory and set the following environment variables:

   ```bash
    AWS_ACCESS_KEY_ID=MY_SECRET_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY=MY_SECRET_ACCESS_KEY
    AWS_REGION=MY_REGION
    POSTGRES_USER=USER
    POSTGRES_PASSWORD=PASSWORD
    POSTGRES_DB=DB_NAME
    POSTGRES_HOST=HOST
    POSTGRES_PORT=PORT
    DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME?schema=public

    JWT_SECRET=JWT_SECRET
    JWT_EXPIRES_IN=EXPIRATION_TIME
    PORT=PORT_NUMBER
    ```

4. Run the Prisma migration to create the database schema:

   ```bash
   npx prisma migrate dev --name init
   ```

5. Seed the database with initial data (optional):

   ```bash
   npx prisma db seed
   ```
6. Start the application:

   ```bash
    yarn start:dev
    ```

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
