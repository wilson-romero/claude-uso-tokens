# uso-tokens

Un mod para Claude Code que muestra, en una línea de estado fija bajo el prompt:

- la cuenta y el plan (leídos de tu propio `~/.claude.json`);
- el uso de la ventana de contexto;
- los límites del plan de Claude: ventana de 5 h y semanal, con su hora de reinicio;
- los límites de Codex, si tienes `codex` instalado y con sesión iniciada;
- el coste estimado de la sesión.

```
tu@••• Max 5x · ctx 112k/200k (56%) · 5h 21% → 12:20 · semana 51% → jue 22:00 · Codex 5h 33% → 14:28 · semana 64% → sáb 16:07 · US$1.23
```

Avisa con un toast cuando una ventana pasa del 80 % y del 90 %. El comando `/uso` muestra el detalle.

## Instalar

En una sesión de Claude Code en la terminal:

```
/plugin install uso-tokens --marketplace wilson-romero/claude-uso-tokens
```

Responde `y` para añadir el marketplace y elige el ámbito (usuario, el primero, con Enter).

Desde una shell:

```
claude plugin install uso-tokens --marketplace wilson-romero/claude-uso-tokens
```

En la app de escritorio, donde `/plugin` no funciona: pulsa + junto al cuadro del prompt, luego Plugins, Add marketplace con `wilson-romero/claude-uso-tokens`, y después Add plugin.

## Cómo obtiene los datos

- **Contexto, límites de Claude y coste:** de `$.session.usage()` y del evento `session.measure` de la API de mods. Los límites de Claude solo existen en una suscripción y llegan con la primera respuesta de la sesión.
- **Cuenta:** de `$.session.identity()` cuando el mod lo instala una configuración gestionada; si no, solo `emailAddress` y el plan del bloque `oauthAccount` de `~/.claude.json`. Ningún otro dato de ese fichero sale del mod. El dominio del correo se muestra como `•••`, para que no salga en las capturas.
- **Codex:** ejecuta `codex app-server` y pide `account/rateLimits/read`, que lee el uso sin gastar cupo. Lo hace como mucho una vez cada 5 minutos y al ejecutar `/uso`. Nunca usa los reinicios gratuitos del límite.

Las horas de reinicio se muestran en UTC−5 (Bogotá, sin horario de verano).

## Desarrollo

```
claude plugin validate .
claude plugin test .
```
