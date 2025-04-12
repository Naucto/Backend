import { PrismaClient } from '@prisma/client';
import { User } from './interfaces';

const prisma = new PrismaClient();

export const getUsers = async (): Promise<User[]> => {
    try {
      const users = await prisma.user.findMany();
      return users;
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs:', error);
      throw new Error('Impossible de récupérer les utilisateurs');
    }
};

export const getUser = async (id: number): Promise<User | null> => {
    try {
      const user = await prisma.user.findUnique({
        where: {
          id: id,
        },
      });
      return user;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'utilisateur:', error);
      throw new Error('Impossible de récupérer l\'utilisateur');
    }
};

export const postUser = async (userData: Omit<User, 'id' | 'createdAt'>): Promise<User> => {
    try {
      const newUser = await prisma.user.create({
        data: userData,
      });
      return newUser;
    } catch (error) {
      console.error('Erreur lors de la création de l\'utilisateur:', error);
      throw new Error('Impossible de créer l\'utilisateur');
    }
};

export const updateUser = async (id: number, userData: Partial<User>): Promise<User | null> => {
    try {
      const updatedUser = await prisma.user.update({
        where: {
          id: id,
        },
        data: userData,
      });
      return updatedUser;
    } catch (error) {
      console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
      throw new Error('Impossible de mettre à jour l\'utilisateur');
    }
};

export const deleteUser = async (id: number): Promise<User | null> => {
    try {
      const deletedUser = await prisma.user.delete({
        where: {
          id: id,
        },
      });
      return deletedUser;
    } catch (error) {
      console.error('Erreur lors de la suppression de l\'utilisateur:', error);
      throw new Error('Impossible de supprimer l\'utilisateur');
    }
};

export default prisma;
