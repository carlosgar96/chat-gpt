Motor de renderizado FFmpeg para AutoEditor iPhone.
- Se despliega como servicio web gratuito independiente del sitio estático.
- POST /jobs: multipart con imágenes y audio, exportación completa o clips ZIP.
- GET /jobs/:id: estado.
- GET /jobs/:id/download: archivo final.
- GET /health: comprobación FFmpeg.
- Archivos temporales y trabajos caducan; fotos y audio se envían temporalmente al servidor.
- El motor usa movimiento lateral de principio a fin, no recorta la foto y ofrece fondo difuminado.
- No se cobra al usuario; el servicio gratuito puede suspenderse por inactividad y tiene recursos limitados.
