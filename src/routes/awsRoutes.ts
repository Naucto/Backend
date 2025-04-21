import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { Readable } from 'stream';
import * as s3Service from '@aws/s3service';

const router = express.Router();
const upload = multer();

// Lister les buckets
router.get('/s3-list', async (_req, res) => {
  try {
    const buckets = await s3Service.listBuckets();
    res.json({ buckets });
  } catch (error) {
    console.error('Error listing buckets:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des buckets' });
  }
});

// Lister les objets d’un bucket
router.get('/s3-list/:bucketName', async (req, res) => {
  try {
    const contents = await s3Service.listObjects(req.params.bucketName);
    res.json({ contents });
  } catch (error) {
    console.error('Error listing objects:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des objets' });
  }
});

// Générer une URL signée de téléchargement
router.get('/s3-download-url/:bucketName/:key', async (req, res) => {
  try {
    const url = await s3Service.getSignedDownloadUrl(req.params.bucketName, decodeURIComponent(req.params.key));
    res.json({ url });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: 'Impossible de générer l’URL signée' });
  }
});

// Télécharger un fichier (stream direct)
router.get('/s3-download/:bucketName/:key', async (req, res) => {
  try {
    const { body, contentType, contentLength } = await s3Service.downloadFile(
      req.params.bucketName,
      decodeURIComponent(req.params.key)
    );

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(req.params.key)}"`);
    res.setHeader('Content-Length', contentLength?.toString() || '0');

    if (body instanceof Readable) {
      body.pipe(res);
    } else {
      res.status(500).json({ error: 'Fichier non lisible' });
    }
  } catch (error) {
    console.error('Erreur lors du téléchargement du fichier :', error);
    res.status(500).json({ error: 'Erreur serveur lors du téléchargement du fichier' });
  }
});

// Uploader un fichier
router.post('/s3-upload/:bucketName', upload.single('file'), async (req, res) => {
  const file = req.file;
  const metadata = req.body.metadata || {};

  if (!file) {
    res.status(400).json({ error: 'Aucun fichier fourni' });
    return;
  }

  try {
    await s3Service.uploadFile(req.params.bucketName, file, metadata);
    res.status(200).json({ message: 'Fichier uploadé avec succès' });
  } catch (error) {
    console.error('Erreur lors de l’upload :', error);
    res.status(500).json({ error: 'Erreur lors de l’upload vers S3' });
  }
});

// Supprimer un fichier
router.delete('/s3-delete/:bucketName/:key', async (req, res) => {
  try {
    await s3Service.deleteFile(req.params.bucketName, decodeURIComponent(req.params.key));
    res.status(200).json({ message: 'Fichier supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression S3 :', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du fichier' });
  }
});

// Supprimer plusieurs fichiers
router.delete('/s3-delete-multiple/:bucketName', async (req, res) => {
  try {
    const result = await s3Service.deleteFiles(req.params.bucketName, req.body.keys);
    res.status(200).json({ message: 'Fichiers supprimés avec succès', deleted: result, });
  } catch (error) {
    console.error('Erreur suppression S3 :', error);
    res.status(500).json({ error: 'Erreur lors de la suppression des fichiers' });
  }
});

// Supprimer un bucket
router.delete('/s3-bucket/:bucketName', async (req, res) => {
  try {
    await s3Service.deleteBucket(req.params.bucketName);
    res.status(200).json({ message: 'Bucket supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression bucket :', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du bucket' });
  }
});

// Créer un bucket
router.post('/s3-bucket/:bucketName', async (req, res) => {
  try {
    await s3Service.createBucket(req.params.bucketName);
    res.status(201).json({ message: 'Bucket créé avec succès' });
  } catch (error: any) {
    console.error('Erreur création bucket :', error);
    res.status(500).json({ error: 'Erreur lors de la création du bucket', details: error.message });
  }
});

// Récupérer les métadonnées
router.get('/s3-metadata/:bucketName/:key', async (req, res) => {
  try {
    const metadata = await s3Service.getObjectMetadata(req.params.bucketName, decodeURIComponent(req.params.key));
    res.status(200).json({ metadata });
  } catch (error) {
    console.error('Erreur métadonnées :', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des métadonnées' });
  }
});

// Générer une politique
router.post('/s3-policy/:bucketName', async (req, res) => {
  const { actions = ['s3:GetObject'], effect = 'Allow', principal = '*', prefix = '*' } = req.body;

  try {
    const policy = s3Service.generateBucketPolicy(req.params.bucketName, actions, effect, principal, prefix);
    res.status(200).json({ message: 'Politique générée avec succès', policy });
  } catch (error) {
    console.error('Erreur génération politique :', error);
    res.status(500).json({ error: 'Erreur lors de la génération de la politique' });
  }
});

// Appliquer une politique
router.post('/s3-apply-policy/:bucketName', async (req, res) => {
  const { policy } = req.body;
  if (!policy) {
    res.status(400).json({ error: 'Aucune politique fournie' });
    return;
  }
  try {
    await s3Service.applyBucketPolicy(req.params.bucketName, policy);
    res.status(200).json({ message: 'Politique appliquée avec succès' });
  } catch (error) {
    console.error('Erreur application politique :', error);
    res.status(500).json({ error: 'Erreur lors de l’application de la politique' });
  }
});

export default router;
