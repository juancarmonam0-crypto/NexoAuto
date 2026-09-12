/**
 * Nexo Auto — public (customer-facing) Spanish copy.
 *
 * Written as United States customer-facing Spanish, not a literal translation of
 * the English file. The goal is that a Spanish-speaking buyer reads a page that
 * sounds like it was written in Spanish, while every factual promise — especially
 * anything about financing — is IDENTICAL in strength to the English edition.
 * Nothing here may imply guaranteed approval.
 *
 * The key set is enforced by the dictionary type: `npm run typecheck` fails if
 * this file and `en.ts` drift apart, so a page can never be 70% translated
 * without the build saying so.
 *
 * `{{double braces}}` mark the run of words the page emphasises in Nexo orange,
 * mirroring the English headline treatment. Vehicle DATA (VIN, stock number,
 * make, model, trim, mileage, prices) is never translated.
 */
export const es = {
  // ---- Shared / metadata -------------------------------------------------
  "meta.siteName": "Nexo Auto",
  "meta.home.title": "Nexo Auto — Mejores autos. Una forma más simple.",
  "meta.home.description":
    "Autos usados cuidadosamente seleccionados, precios claros y diferentes formas de comprar. Mira lo disponible y conoce tus opciones antes de decidir.",
  "meta.inventory.title": "Inventario",
  "meta.inventory.description":
    "Todos los vehículos publicados en Nexo Auto, con precio, millaje, equipamiento y fotos.",
  "meta.vehicle.notFound": "Vehículo no encontrado",
  "meta.vehicle.description": "{vehicle} con {mileage} millas, disponible en Nexo Auto por {price}.",
  "meta.tagline": "Comprar tu auto, más simple",

  // ---- Brand family ------------------------------------------------------
  "brand.familyNote": "Parte de la familia {family} — el mismo equipo detrás de Nexo Rental.",
  "brand.familyName": "Nexo",

  // ---- Language selector -------------------------------------------------
  "language.label": "Idioma",
  "language.switchTo": "Cambiar a {language}",
  "language.english": "Inglés",
  "language.spanish": "Español",

  // ---- Theme control -----------------------------------------------------
  "theme.label": "Tema",
  "theme.switchTo": "Cambiar a {theme}",
  "theme.light": "Claro",
  "theme.dark": "Oscuro",
  "theme.system": "Sistema",
  "theme.legend": "Apariencia",

  // ---- Header / navigation ----------------------------------------------
  "nav.primary": "Principal",
  "nav.openMenu": "Abrir menú",
  "nav.closeMenu": "Cerrar menú",
  "nav.menuTitle": "Menú",
  "nav.home": "{name} — inicio",
  "nav.inventory": "Inventario",
  "nav.howItWorks": "Cómo funciona",
  "nav.financing": "Financiamiento",
  "nav.about": "Nosotros",
  "nav.contact": "Contacto",
  "nav.browseCars": "Ver autos",
  "nav.browseCarsShort": "Ver autos",
  "nav.callDealer": "Llamar a {name} al {phone}",
  "nav.callUs": "Llámanos",
  "nav.emailUs": "Escríbenos",
  "nav.operatorSignIn": "Acceso de operadores",

  // ---- Accessibility -----------------------------------------------------
  "a11y.srHeadline": "{name} — autos usados, precios claros, compra sencilla",
  "a11y.heroImage": "Una SUV blanca fotografiada frente al horizonte de una ciudad al atardecer",

  // ---- Homepage: hero ----------------------------------------------------
  "home.hero.eyebrow": "Comprar tu auto, más simple",
  "home.hero.headline": "Mejores autos.\nUna {{forma más simple.}}",
  "home.hero.subtext":
    "Autos usados cuidadosamente seleccionados, precios claros y diferentes formas de comprar. Mira lo disponible y conoce tus opciones antes de decidir.",
  "home.hero.primaryCta": "Ver autos",
  "home.hero.secondaryCta": "Cómo funciona",
  "home.hero.assurancePricing": "Precios claros",
  "home.hero.assurancePricingBody": "Sin cargos escondidos",
  "home.hero.assuranceSelection": "Inventario seleccionado con cuidado",
  "home.hero.assuranceSelectionBody": "Calidad en la que puedes confiar",
  "home.hero.assuranceFinancing": "Orientación sobre financiamiento",
  "home.hero.assuranceFinancingBody": "Opciones para tu presupuesto",

  // ---- Homepage: inventory preview ---------------------------------------
  "home.inventory.eyebrow": "Inventario",
  "home.inventory.title": "Encuentra el auto ideal para tu próxima etapa.",
  "home.inventory.subtitle":
    "Todos los vehículos de abajo están disponibles ahora mismo, con el precio a la vista.",
  "home.inventory.viewAll": "Ver todo el inventario",
  "home.inventory.empty.title": "Estamos eligiendo nuevos vehículos",
  "home.inventory.empty.body":
    "Publicamos los vehículos cuando están listos, no antes. Dinos qué buscas y te avisamos cuando algo encaje.",
  "home.inventory.empty.call": "Llama al {phone}",
  "home.inventory.empty.email": "Dinos qué necesitas",
  "home.inventory.empty.mailSubject": "Solicitud de vehículo — {name}",
  "home.inventory.empty.recheck": "Revisar el inventario otra vez",

  // ---- Homepage: four-step journey ---------------------------------------
  "home.journey.eyebrow": "Cómo funciona",
  "home.journey.title": "Cuatro pasos, sin adivinanzas",
  "home.journey.subtitle": "El mismo proceso si pagas de contado o con financiamiento.",
  "home.journey.1.title": "Explora",
  "home.journey.1.body": "Mira el inventario realmente disponible.",
  "home.journey.2.title": "Compara",
  "home.journey.2.body": "Consulta precio, fotos y detalles del vehículo.",
  "home.journey.3.title": "Arma tu oferta",
  "home.journey.3.body": "Revisa opciones que se ajusten a tu presupuesto.",
  "home.journey.4.title": "Compra con confianza",
  "home.journey.4.body": "Completa los siguientes pasos con información clara.",
  "home.journey.cta": "Empieza por los autos",

  // ---- Homepage: buying options band -------------------------------------
  "home.options.eyebrow": "Opciones de compra",
  "home.options.title": "Diferentes formas de comprar.\nUna {{experiencia simple.}}",
  "home.options.subtitle":
    "Elige la estructura que se ajuste a tu presupuesto. Revisamos los números contigo antes de decidir nada.",
  "home.options.cash.title": "Pago de contado",
  "home.options.cash.body": "Acuerdas el precio, firmas el papeleo y te llevas las llaves.",
  "home.options.finance.title": "Financiamiento tradicional",
  "home.options.finance.body": "Solicitas con un financiador, con acompañamiento en el proceso.",
  "home.options.guided.title": "Estructura de compra guiada",
  "home.options.guided.body": "Trae tu presupuesto y mira los plazos que encajan.",
  "home.options.flexible.title": "Arrendamiento / con opción a compra",
  "home.options.flexible.body": "Pregunta qué aplica para el vehículo que te interesa.",
  "home.options.disclaimerLabel": "Sobre el financiamiento:",
  "home.options.disclaimer":
    "las cifras de pago, plazo y tasa son estimados solo para planear — no son una oferta de crédito, ni una decisión de crédito, ni una garantía de aprobación. Las condiciones finales las define el financiador y dependen de tu solicitud.",

  // ---- Homepage: Nexo family story ---------------------------------------
  "home.family.eyebrow": "Parte de la familia Nexo",
  "home.family.title": "Más que un auto.\nUn mejor {{mañana.}}",
  "home.family.body":
    "Nexo Auto forma parte de la familia Nexo — el mismo equipo detrás de Nexo Rental. Partimos de una idea simple: hacer que los servicios de todos los días sean más fáciles de entender y usar.",
  "home.family.cta": "Ver inventario",
  "home.family.note": "El mismo camino, una forma más simple de avanzar.",

  // ---- Vehicle card -------------------------------------------------------
  "card.photosSoon": "Fotos muy pronto",
  "card.askingPrice": "Precio",
  "card.explore": "Ver",
  "card.viewAction": "Ver {vehicle}, número de stock {stock}, {price}",
  "card.photoAlt": "Foto de {vehicle}",
  "card.noPhoto": "Foto muy pronto",

  // ---- Inventory index ----------------------------------------------------
  "inventory.breadcrumbHome": "Inicio",
  "inventory.breadcrumbCurrent": "Inventario",
  "inventory.title": "Encuentra el auto ideal para tu próxima etapa.",
  "inventory.intro": "Todo lo publicado por {name}, con el precio a la vista.",
  "inventory.searchLabel": "Buscar en el inventario por marca, modelo, VIN o número de stock",
  "inventory.searchPlaceholder": "Marca, modelo, VIN…",
  "inventory.searchAction": "Buscar",
  "inventory.resultsMatching": "Resultados para {query}",
  "inventory.resultsCountOne": "{count} vehículo publicado",
  "inventory.resultsCountOther": "{count} vehículos publicados",
  "inventory.empty.searchTitle": "Ningún vehículo coincide con {query}",
  "inventory.empty.title": "No hay vehículos publicados ahora",
  "inventory.empty.searchBody":
    "Prueba con otra marca, modelo o número de stock — o borra la búsqueda para ver todo lo publicado.",
  "inventory.empty.body":
    "Los nuevos vehículos aparecen aquí cuando están listos para la venta. Nada se publica hasta que está realmente disponible.",
  "inventory.empty.clearSearch": "Borrar búsqueda",
  "inventory.empty.home": "Volver al inicio",
  "inventory.empty.askAboutUpcoming": "Preguntar por los próximos autos",
  "inventory.paginationLabel": "Páginas del inventario",
  "inventory.previous": "Anterior",
  "inventory.next": "Siguiente",
  "inventory.page": "Página {page}",

  // ---- Vehicle detail -----------------------------------------------------
  "vehicle.notFoundTitle": "Vehículo no encontrado",
  "vehicle.statusAvailable": "Disponible",
  "vehicle.statusReserved": "Reservado",
  "vehicle.askingPrice": "Precio",
  "vehicle.priceNote": "Más impuestos, título y registro cuando apliquen.",
  "vehicle.about": "Sobre este vehículo",
  "vehicle.features": "Equipamiento y características",
  "vehicle.interestedTitle": "¿Te interesa este vehículo?",
  "vehicle.interestedBody":
    "Pregúntanos si sigue disponible, agenda una visita o revisemos los números juntos.",
  "vehicle.call": "Llama al {phone}",
  "vehicle.emailAction": "Escribir sobre este vehículo",
  "vehicle.noContact": "Los datos de contacto de la agencia todavía no están configurados.",
  "vehicle.optionsLink": "Ver opciones de contado, financiamiento y planes flexibles",
  "vehicle.financeNote":
    "Las cifras de pago y plazo son solo estimados — no son una oferta, ni una decisión de crédito, ni una garantía de aprobación.",
  "vehicle.specs": "Especificaciones",
  "vehicle.backToInventory": "Volver a todo el inventario de {name}",
  "vehicle.mailSubject": "Consulta sobre {vehicle} (Stock #{stock})",
  "vehicle.srSummary": "{vehicle}, precio {price}",

  // ---- Specifications labels ---------------------------------------------
  "spec.mileage": "Millaje",
  "spec.exteriorColor": "Color exterior",
  "spec.interiorColor": "Color interior",
  "spec.transmission": "Transmisión",
  "spec.drivetrain": "Tracción",
  "spec.engine": "Motor",
  "spec.fuelType": "Combustible",
  "spec.bodyType": "Tipo de carrocería",
  "spec.titleStatus": "Estado del título",
  "spec.location": "Ubicación",
  "spec.notRecorded": "Sin registrar",
  "spec.miles": "{count} millas",
  "spec.stockNumber": "Stock #{stock}",
  "spec.vin": "VIN {vin}",

  // ---- Gallery ------------------------------------------------------------
  "gallery.placeholder": "Foto no disponible",
  "gallery.previous": "Foto anterior",
  "gallery.next": "Foto siguiente",
  "gallery.counter": "{current} / {total}",
  "gallery.thumbnail": "Foto {index} de {total}",

  // ---- Status badges ------------------------------------------------------
  "status.available": "DISPONIBLE",
  "status.reserved": "RESERVADO",
  "status.demo": "DEMO",

  // ---- Footer -------------------------------------------------------------
  "footer.explore": "Explora",
  "footer.browseInventory": "Inventario",
  "footer.howItWorks": "Cómo funciona",
  "footer.buyingOptions": "Financiamiento",
  "footer.whyNexo": "Nosotros",
  "footer.talkToUs": "Contacto",
  "footer.noContact": "Los datos de contacto aparecerán aquí cuando se configuren en la agencia.",
  "footer.financeNote": "Las cifras de financiamiento en las publicaciones son estimados, nunca aprobaciones.",
  "footer.rights": "© {year} {name}. Todos los derechos reservados.",
  "footer.taglineFallback":
    "Autos usados cuidadosamente seleccionados, precios claros y un camino directo desde que miras hasta que manejas.",
  "footer.appearance": "Apariencia",

  // ---- Customer-visible failure states -----------------------------------
  "error.genericTitle": "Algo salió mal",
  "error.genericBody": "Inténtalo de nuevo. Si sigue pasando, llámanos o escríbenos y te ayudamos directamente.",
} as const;
