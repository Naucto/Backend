// src/routes/userRoutes.ts
import { getUsers, getUser, postUser, updateUser, deleteUser } from '../db';
import express from 'express';

const router = express.Router();

// Récupérer tous les utilisateurs
router.get('/', async (req, res) => {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
  }
});

router.get('/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);

  try {
    const user = await getUser(userId);

    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Ajouter un nouvel utilisateur
router.post('/', async (req, res) => {
  const { name, email } = req.body;
  try {
    const newUser = await postUser({ email, name });
    res.status(201).json(newUser);
  } catch (error) {
    res.status(400).json({ error: 'Erreur lors de la création de l\'utilisateur' });
  }
});

// Mettre à jour un utilisateur
router.put('/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { email, name } = req.body;
  try {
    const updatedUser = await updateUser(userId, { email, name });
    if (updatedUser) {
      res.json(updatedUser);
    } else {
      res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur' });
  }
});

// Supprimer un utilisateur
router.delete('/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    const deletedUser = await deleteUser(userId);
    if (deletedUser) {
      res.status(204).end();
    } else {
      res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur' });
  }
});

export default router;
