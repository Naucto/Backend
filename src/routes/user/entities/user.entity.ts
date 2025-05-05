export class User {
  id: number;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  createdAt: Date;
  roles?: { id: number; name: string }[];
}
