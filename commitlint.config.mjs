const TYPES = ["ADD", "REMOVE", "UPDATE", "REFACTO", "CLEAN", "FIX"];
const RE = /^\[([A-Z-]+)\] \[([A-Z]+)\] ([A-Z].*)$/;

export default {
  rules: { "naucto-format": [2, "always"] },
  plugins: [
    {
      rules: {
        "naucto-format": ({ header }) => {
          const m = RE.exec(header ?? "");
          if (!m) return [false, "Header must be \"[PART] [TYPE] Capitalized message\""];
          if (!TYPES.includes(m[2])) return [false, `TYPE must be one of ${TYPES.join("/")}`];
          return [true];
        },
      },
    },
  ],
};
