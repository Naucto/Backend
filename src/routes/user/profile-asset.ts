export type ProfileAsset = "profile" | "background";

export function profileAssetKey(userId: number, asset: ProfileAsset): string {
  return `users/${userId}/${asset}`;
}
