// src/routes/userRoutes.ts
import prisma from '../db';
import express from 'express';

const router = express.Router();

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

export default router;
