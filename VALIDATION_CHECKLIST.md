# Checklist de validación manual

1. DM `/subir`: completar flujo hasta confirmación. Debe crear registro `phones.status=pending`.
2. `/cancelar`: borra draft y responde confirmación.
3. En grupo `/subir`: respuesta que invita a DM.
4. `/reportar 123 ejemplo`: inserta en `reports` (ver en DB).
5. `/suscribir`: crea/actualiza `subscriptions`.
6. Panel `/` con Basic Auth: lista pendientes.
7. Aprobar/rechazar: botones funcionan; elemento cambia de estado.
8. `/approved` lista modelos aprobados.
9. `/exports` descarga JSON y CSV válidos.
10. `/reports` lista abiertos y permite marcarlos “reviewed”.
11. Verificar que ninguna página cliente use `SUPABASE_SERVICE_ROLE_KEY`.
12. Cargar ~1000 filas y exportar; desempeño aceptable.
13. Revisar logs de Vercel: sin errores de “supabaseUrl is required”.
14. Webhook del bot devuelve 200 siempre.
15. (Opcional) Configurar backup diario con GitHub Actions usando el endpoint de export.
