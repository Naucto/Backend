import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';

import awsRoutes from './src/routes/awsRoutes';
import userRoutes from './src/routes/userRoutes';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${req.method} request for ${req.url}`);
  next();
});

app.use('/aws', awsRoutes);
app.use('/users', userRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World');  
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ message: 'Route non trouvée' });
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);  
});

