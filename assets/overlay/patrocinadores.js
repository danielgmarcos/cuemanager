/* ================= PATROCINADORES (lista única) =================
   Usada pelo overlay (overlay.html) e pelos ecrãs de início/fim (ecra.html).
   - id:   identificador (também usado em CONFIG.pesos do overlay)
   - peso: 4, 2 ou 1 — quanto maior, mais vezes aparece e maior é o logótipo
           (0 = não aparece)
   - src:  imagem em assets/overlay/
   - nome: texto alternativo
   Para acrescentar um patrocinador: copiar a imagem para assets/overlay/
   e acrescentar uma linha aqui. */
window.PATROCINADORES = [
  { id: "sepitra",    peso: 4, src: "assets/overlay/sponsor-sepitra.jpg",    nome: "Sepitra" },
  { id: "kroisant",   peso: 4, src: "assets/overlay/sponsor-kroisant.jpg",   nome: "Kroisant" },
  { id: "imperial",   peso: 4, src: "assets/overlay/sponsor-imperial.jpg",   nome: "Imperial e Kool Caffé" },
  { id: "grafidoon",  peso: 4, src: "assets/overlay/sponsor-grafidoon.jpg",  nome: "Grafidoon" },
  { id: "ajorfao",    peso: 4, src: "assets/overlay/sponsor-ajorfao.jpg",    nome: "A. J. Órfão" },
  { id: "cafetaria",  peso: 4, src: "assets/overlay/sponsor-cafetaria.jpg",  nome: "Cafetaria da Vila" },
  { id: "condeixa",   peso: 2, src: "assets/overlay/sponsor-condeixa.jpg",   nome: "Município de Condeixa" },
  { id: "castellvm",  peso: 2, src: "assets/overlay/sponsor-castellvm.jpg",  nome: "Aromas Castellvm" },
  { id: "freguesias", peso: 2, src: "assets/overlay/sponsor-freguesias.jpg", nome: "Junta de Freguesia" },
  { id: "mga",        peso: 2, src: "assets/overlay/sponsor-mga.jpg",        nome: "MGA Comunicações" },
  { id: "estoca",     peso: 2, src: "assets/overlay/sponsor-estoca.jpg",     nome: "Estóca Rebóca e Pintóca" },
  { id: "vcpadel",    peso: 1, src: "assets/overlay/sponsor-vcpadel.jpg",    nome: "VC Padel" },
  { id: "nova",       peso: 1, src: "assets/overlay/sponsor-nova.jpg",       nome: "Nova Barbearia" }
];
