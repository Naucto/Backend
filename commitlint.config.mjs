const TYPES = ['ADD', 'REMOVE', 'UPDATE', 'REFACTO', 'CLEAN', 'FIX'];
const RE = /^\[([A-Z-]+)\] \[([A-Z]+)\] ([A-Z].*)$/;

export default {
  rules: { 'naucto-format': [2, 'always'] },
  plugins: [
    {
      rules: {
        'naucto-format': ({ header }) => {
          const match = RE.exec(header ?? '');
          if (!match) {
            return [false, 'Header must be "[PART] [TYPE] Capitalized message"'];
          }
          if (!TYPES.includes(match[2])) {
            return [false, `TYPE must be one of ${TYPES.join('/')}`];
          }
          return [true];
        },
      },
    },
  ],
};
