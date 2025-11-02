export function isStringValue(value: string): value is `${number}${"s" | "m" | "h" | "d" | "w" | "y"}` {
    return /^\d+(s|m|h|d|w|y)$/.test(value);
}
