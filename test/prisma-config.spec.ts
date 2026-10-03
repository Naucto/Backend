jest.mock("dotenv", () => ({ config: jest.fn() }));

/** The connection URL the Prisma CLI is handed when it loads the config under `env`. */
async function datasourceUrl(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  process.env = env;

  let url: string | undefined;
  await jest.isolateModulesAsync(async () => {
    const { default: config } = await import("../prisma.config");
    url = config.datasource?.url;
  });

  return url;
}

describe("prisma.config", () => {
  const environment = process.env;

  afterEach(() => {
    process.env = environment;
  });

  it("uses DATABASE_URL as it is when the environment carries one", async () => {
    const url = await datasourceUrl({
      DATABASE_URL: "postgresql://naucto:secret@db:5432/naucto",
      POSTGRES_USER: "other",
      POSTGRES_PASSWORD: "other",
      POSTGRES_DB: "other"
    });

    expect(url).toBe("postgresql://naucto:secret@db:5432/naucto");
  });

  it("reaches the database on localhost when only the POSTGRES_* values are set", async () => {
    const url = await datasourceUrl({
      POSTGRES_USER: "naucto",
      POSTGRES_PASSWORD: "p@ss/word",
      POSTGRES_DB: "naucto",
      POSTGRES_HOST: "db",
      POSTGRES_PORT: "5433"
    });

    expect(url).toBe("postgresql://naucto:p%40ss%2Fword@localhost:5433/naucto");
  });

  it("still loads when the environment describes no database", async () => {
    expect(await datasourceUrl({})).toBe("");
  });
});
