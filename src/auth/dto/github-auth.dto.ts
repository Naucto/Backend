export interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface GithubUser {
  login: string;
  name: string | null;
  email: string | null;
}

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}
