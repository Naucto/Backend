import express, { Request, Response } from 'express';
import path from 'path';
import { Readable } from 'stream';
import { ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CreateBucketCommand, DeleteBucketCommand, HeadObjectCommand, PutObjectAclCommand, PutBucketPolicyCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3Client from '../aws/s3';
import multer from 'multer';

const router = express.Router();
const upload = multer();

// Route pour lister les buckets S3
router.get('/s3-list', async (req: Request, res: Response) => {
  try {
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);
    res.json({ buckets: response.Buckets });
  } catch (error) {
    console.error('Error listing buckets:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des buckets' });
  }
});

// Route pour lister les objets d'un bucket S3
router.get('/s3-list/:bucketName', async (req: Request, res: Response) => {
  const bucketName = req.params.bucketName;

  try {
    const command = new ListObjectsV2Command({ Bucket: bucketName });
    const response = await s3Client.send(command);
    res.json({ contents: response.Contents });
  } catch (error) {
    console.error('Error listing objects:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des objets du bucket' });
  }
});

// Route pour créer une URL de download d'un fichier d'un bucket S3
router.get('/s3-download-url/:bucketName/:key', async (req: Request, res: Response) => {
  const { bucketName, key } = req.params;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: decodeURIComponent(key),
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1h
    res.json({ url });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: 'Impossible de générer l’URL signée' });
  }
});

// Route pour télécharger un fichier d'un bucket S3
router.get('/s3-download/:bucketName/:key', async (req: Request, res: Response) => {
  const { bucketName, key } = req.params;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: decodeURIComponent(key),
    });

    const { Body, ContentType, ContentLength } = await s3Client.send(command);

    res.setHeader('Content-Type', ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
    res.setHeader('Content-Length', ContentLength?.toString() || '0');

    if (Body instanceof Readable) {
      Body.pipe(res);
    } else {
      res.status(500).json({ error: 'Fichier non lisible' });
    }
  } catch (error) {
    console.error('Erreur lors du téléchargement du fichier :', error);
    res.status(500).json({ error: 'Erreur serveur lors du téléchargement du fichier' });
  }
});

// Route pour uploader un fichier dans un bucket S3
router.post('/s3-upload/:bucketName', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
    const file = (req as Request & { file: Express.Multer.File }).file;
    const bucketName = req.params.bucketName;
    const metadata = req.body.metadata || {};

    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }


    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: metadata,
      });

      await s3Client.send(command);
      res.status(200).json({ message: 'Fichier uploadé avec succès' });
    } catch (error) {
      console.error('Erreur lors de l’upload :', error);
      res.status(500).json({ error: 'Erreur lors de l’upload vers S3' });
    }
  }
);

// Route pour supprimer un fichier
router.delete('/s3-delete/:bucketName/:key', async (req: Request, res: Response) => {
  const { bucketName, key } = req.params;

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: decodeURIComponent(key),
    });

    await s3Client.send(command);
    res.status(200).json({ message: `Fichier "${key}" supprimé du bucket "${bucketName}"` });
  } catch (error) {
    console.error('Erreur suppression S3 :', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du fichier' });
  }
});

// Route pour supprimer un bucket S3
router.delete('/s3-bucket/:bucketName', async (req: Request, res: Response) => {
  const { bucketName } = req.params;

  try {
    const command = new DeleteBucketCommand({
      Bucket: bucketName,
    });

    await s3Client.send(command);
    res.status(200).json({ message: `Bucket "${bucketName}" supprimé avec succès` });
  } catch (error) {
    console.error('Erreur lors de la suppression du bucket :', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du bucket' });
  }
});

// Route pour créer un bucket
router.post('/s3-bucket/:bucketName', async (req: Request, res: Response) => {
  const { bucketName } = req.params;

  try {
    const command = new CreateBucketCommand({
      Bucket: bucketName,
      // CreateBucketConfiguration: {
      //   LocationConstraint: 'eu-west-3'
      // }
    });

    await s3Client.send(command);
    res.status(201).json({ message: `Bucket "${bucketName}" créé avec succès` });
  } catch (error: any) {
    console.error('Erreur lors de la création du bucket :', error);
    res.status(500).json({
      error: 'Erreur lors de la création du bucket',
      details: error.message,
    });
  }
});

// Route pour récupérer les métadonnées d’un objet
router.get('/s3-metadata/:bucketName/:key', async (req: Request, res: Response) => {
  const { bucketName, key } = req.params;

  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: decodeURIComponent(key),
    });

    const response = await s3Client.send(command);

    res.status(200).json({ metadata: response.Metadata });
  } catch (error) {
    console.error('Erreur lors de la récupération des métadonnées :', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des métadonnées' });
  }
});

// Route pour générer une politique de bucket S3
router.post('/s3-policy/:bucketName', async (req: Request, res: Response) => {
  const { bucketName } = req.params;
  const { actions = ['s3:GetObject'], effect = 'Allow', principal = '*', prefix = '*' } = req.body;

  try {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'CustomPolicy',
          Effect: effect,
          Principal: principal === '*' ? '*' : { AWS: principal },
          Action: actions,
          Resource: `arn:aws:s3:::${bucketName}/${prefix}`,
        },
      ],
    };

    res.status(200).json({
      message: 'Politique générée avec succès',
      policy,
    });
  } catch (error) {
    console.error('Erreur lors de la génération de la politique :', error);
    res.status(500).json({ error: 'Erreur lors de la génération de la politique' });
  }
});

export default router;
