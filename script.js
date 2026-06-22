// --- CONFIGURACIÓN E INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initMathCalculator();
    initSimulation();
    initAmbientParticles();
    
    // Ejecutar renderizado inicial de KaTeX para asegurar la notación
    setTimeout(() => {
        if (window.renderMathInElement) {
            window.renderMathInElement(document.body, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false }
                ],
                throwOnError: false
            });
        }
        updateMathExplanation(); // Actualizar la calculadora
    }, 500);
});

// --- SISTEMA DE PESTAÑAS (TABS) ---
function initTabs() {
    const navButtons = document.querySelectorAll(".nav-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.getAttribute("data-target");

            // Quitar clase activa de botones
            navButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Ocultar todas las pestañas y mostrar la seleccionada
            tabContents.forEach(content => {
                if (content.id === targetTab) {
                    content.classList.add("active");
                } else {
                    content.classList.remove("active");
                }
            });

            // Si es la pestaña matemática, refrescar la calculadora
            if (targetTab === "modelo-tab") {
                updateMathExplanation();
            }
        });
    });
}


// --- MOTOR DE LA SIMULACIÓN DE ENFRIAMIENTO ---
let simInterval = null;
let isPlaying = false;
let currentTime = 0; // en minutos
let speedMultiplier = 1;
let chart = null;

// Parámetros físicos actuales
let tempInicial = 90;
let tempAmbiente = 20;
let coolingK = 0.05;

// Variables de estado de temperatura
let currentTemp = 90;

function initSimulation() {
    // Referencias del DOM
    const sliderTempInit = document.getElementById("temp-inicial");
    const sliderTempAmb = document.getElementById("temp-ambiente");
    const sliderK = document.getElementById("const-k");

    const valTempInit = document.getElementById("val-temp-inicial");
    const valTempAmb = document.getElementById("val-temp-ambiente");
    const valK = document.getElementById("val-const-k");

    const btnPlayPause = document.getElementById("btn-play-pause");
    const btnReset = document.getElementById("btn-reset");
    const speedBtns = document.querySelectorAll(".speed-btn");

    const readTempPizza = document.getElementById("read-temp-pizza");
    const readTime = document.getElementById("read-time");
    const readDiff = document.getElementById("read-diff");

    const pizzaCheese = document.getElementById("pizza-cheese");
    const pizzaStatus = document.getElementById("pizza-status");
    const thermalGlow = document.getElementById("thermal-glow");

    // 1. Inicializar Gráfico con Chart.js
    const ctx = document.getElementById("coolingChart").getContext("2d");
    
    // Crear gradiente pastel para el relleno del gráfico
    const chartGrad = ctx.createLinearGradient(0, 0, 0, 200);
    chartGrad.addColorStop(0, "rgba(255, 181, 167, 0.4)"); // Rosa pastel
    chartGrad.addColorStop(1, "rgba(255, 229, 180, 0.0)"); // Transparente

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 61}, (_, i) => i), // 0 a 60 minutos
            datasets: [
                {
                    label: 'Temperatura Pizza (°C)',
                    data: [], // Se llena dinámicamente
                    borderColor: '#ff9b85',
                    backgroundColor: chartGrad,
                    borderWidth: 3.5,
                    tension: 0.35,
                    pointRadius: [], // Controlado en la actualización
                    pointBackgroundColor: '#ff6b6b',
                    pointHoverRadius: 6,
                    fill: true
                },
                {
                    label: 'Temperatura Ambiente (°C)',
                    data: Array(61).fill(tempAmbiente),
                    borderColor: '#a2d2ff',
                    borderWidth: 2,
                    borderDash: [6, 6],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { family: 'Inter', size: 12, weight: '500' },
                        color: '#3d312a'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.raw.toFixed(1)}°C`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Tiempo (minutos)',
                        color: '#705f55',
                        font: { family: 'Outfit', size: 12, weight: 'bold' }
                    },
                    grid: { color: '#f1e9df' },
                    ticks: { color: '#705f55', font: { family: 'Inter' } }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Temperatura (°C)',
                        color: '#705f55',
                        font: { family: 'Outfit', size: 12, weight: 'bold' }
                    },
                    grid: { color: '#f1e9df' },
                    ticks: { color: '#705f55', font: { family: 'Inter' } },
                    min: 0,
                    max: 160
                }
            }
        }
    });

    // 2. Manejadores de Sliders (Tiempo Real)
    function syncParams() {
        tempInicial = parseFloat(sliderTempInit.value);
        tempAmbiente = parseFloat(sliderTempAmb.value);
        coolingK = parseFloat(sliderK.value);

        valTempInit.innerText = `${tempInicial}°C`;
        valTempAmb.innerText = `${tempAmbiente}°C`;
        valK.innerText = `${coolingK.toFixed(2)} min⁻¹`;

        // Actualizar el gráfico teórico límite
        chart.data.datasets[1].data = Array(61).fill(tempAmbiente);

        // Si no está corriendo la simulación activa (tiempo en 0), actualizar lecturas instantáneas
        if (currentTime === 0) {
            currentTemp = tempInicial;
            updateUIReadings();
            updatePizzaColor(currentTemp);
        }
        
        chart.update('none'); // Actualización rápida sin animaciones pesadas
    }

    sliderTempInit.addEventListener("input", syncParams);
    sliderTempAmb.addEventListener("input", syncParams);
    sliderK.addEventListener("input", syncParams);

    // Inicializar valores de sliders
    syncParams();

    // 3. Lógica del Enfriamiento (Ecuación Diferencial)
    /* 
       Ley de Enfriamiento de Newton:
       dT/dt = -k(T - Ta)
       
       Solución analítica programada aquí:
       T(t) = Ta + (Ti - Ta) * e^(-k * t)
    */
    function calculateTemperature(t) {
        return tempAmbiente + (tempInicial - tempAmbiente) * Math.exp(-coolingK * t);
    }

    // 4. Actualización del Estado Físico y Gráfico
    function updateUIReadings() {
        readTempPizza.innerText = `${currentTemp.toFixed(1)}°C`;
        readTime.innerText = `${currentTime.toFixed(1)} min`;
        const diff = Math.max(0, currentTemp - tempAmbiente);
        readDiff.innerText = `${diff.toFixed(1)}°C`;

        // Cambiar la badge de estatus
        if (currentTemp > 75) {
            pizzaStatus.innerText = "Caliente 🔥";
            pizzaStatus.style.backgroundColor = "var(--temp-hot)";
            pizzaStatus.style.color = "#ffffff";
        } else if (currentTemp > 45) {
            pizzaStatus.innerText = "Tibio 🍕";
            pizzaStatus.style.backgroundColor = "var(--temp-warm)";
            pizzaStatus.style.color = "var(--text-primary)";
        } else {
            pizzaStatus.innerText = "Frío ❄️";
            pizzaStatus.style.backgroundColor = "var(--temp-cold)";
            pizzaStatus.style.color = "var(--text-primary)";
        }
    }

    // Cambiar color del queso SVG e intensidad de resplandor
    function updatePizzaColor(temp) {
        // Mapear la temperatura a un rango de color HSL
        // Caliente: Rojo-Naranja (H: 20 -> 40)
        // Tibio: Amarillo-Dorado (H: 45 -> 55)
        // Frío: Beige-Queso pálido (H: 50 -> 60, Sat baja, Light alta)
        
        let hue, sat, light;
        
        const maxExpectedTemp = 150;
        const ratio = Math.min(1, Math.max(0, (temp - tempAmbiente) / (maxExpectedTemp - tempAmbiente)));

        if (ratio > 0.6) {
            // Zona muy caliente (Rojo a Naranja)
            const subRatio = (ratio - 0.6) / 0.4;
            hue = 15 + subRatio * 20; // 15 a 35 (Rojizo a Naranja)
            sat = 95;
            light = 50 + (1 - subRatio) * 5; // 50-55%
        } else if (ratio > 0.2) {
            // Zona intermedia (Naranja a Amarillo Queso Derretido)
            const subRatio = (ratio - 0.2) / 0.4;
            hue = 35 + subRatio * 15; // 35 a 50 (Naranja a Amarillo)
            sat = 90 + subRatio * 5;
            light = 55 + (1 - subRatio) * 5;
        } else {
            // Zona fría (Amarillo Queso a Beige apagado)
            const subRatio = ratio / 0.2;
            hue = 45 + subRatio * 5; // 45 a 50
            sat = 55 + subRatio * 35; // Muy desaturado si está frío
            light = 78 - subRatio * 15; // Más claro/opaco frío
        }

        pizzaCheese.setAttribute("fill", `hsl(${hue}, ${sat}%, ${light}%)`);

        // Ajustar el resplandor térmico (thermal-glow)
        const glowOpacity = ratio * 0.75;
        thermalGlow.style.boxShadow = `inset 0 0 50px rgba(255, 77, 0, ${glowOpacity})`;
    }

    // 5. Ciclo de Simulación Principal (Reloj Físico)
    function tick() {
        // Avanzar el tiempo según el multiplicador de velocidad
        // 0.1 minutos por cada tick (que ocurre cada 100ms) por velocidad
        const dt = 0.05 * speedMultiplier;
        currentTime += dt;

        if (currentTime >= 60) {
            currentTime = 60;
            pauseSimulation();
        }

        // Calcular nueva temperatura mediante la solución analítica de la EDO
        currentTemp = calculateTemperature(currentTime);

        // Actualizar UI
        updateUIReadings();
        updatePizzaColor(currentTemp);

        // Agregar datos al gráfico
        updateChartData();

        if (currentTime >= 60) {
            // Fin de simulación
            isPlaying = false;
            btnPlayPause.innerHTML = `<span>▶</span> <span>Iniciar Tiempo</span>`;
        }
    }

    function updateChartData() {
        const dataPoints = [];
        const pointRadii = [];

        // Generar puntos desde t=0 hasta currentTime
        for (let t = 0; t <= currentTime; t += 0.5) {
            dataPoints.push(calculateTemperature(t));
            pointRadii.push(0); // Ocultar puntos intermedios para curva limpia
        }
        
        // Agregar el último punto exacto actual
        if (currentTime % 0.5 !== 0) {
            dataPoints.push(currentTemp);
            pointRadii.push(0);
        }

        // Hacer que el último punto sea un círculo grande y vistoso
        if (pointRadii.length > 0) {
            pointRadii[pointRadii.length - 1] = 6;
        }

        chart.data.datasets[0].data = dataPoints;
        chart.data.datasets[0].pointRadius = pointRadii;
        chart.update('none'); // Update rápido
    }

    // 6. Controles del Reproductor (Play, Pause, Reset)
    function startSimulation() {
        if (currentTime >= 60) {
            resetSimulation();
        }
        isPlaying = true;
        btnPlayPause.innerHTML = `<span>⏸</span> <span>Pausar Tiempo</span>`;
        btnPlayPause.style.backgroundColor = "var(--pastel-apricot)";
        
        // Bloquear sliders de inicio mientras corre
        sliderTempInit.disabled = true;
        sliderK.disabled = true;
        sliderTempInit.style.opacity = 0.6;
        sliderK.style.opacity = 0.6;

        simInterval = setInterval(tick, 50); // 20 frames por segundo
    }

    function pauseSimulation() {
        isPlaying = false;
        btnPlayPause.innerHTML = `<span>▶</span> <span>Reanudar Tiempo</span>`;
        btnPlayPause.style.backgroundColor = "var(--pastel-rose)";
        clearInterval(simInterval);
    }

    function resetSimulation() {
        pauseSimulation();
        currentTime = 0;
        currentTemp = tempInicial;
        
        // Desbloquear sliders
        sliderTempInit.disabled = false;
        sliderK.disabled = false;
        sliderTempInit.style.opacity = 1;
        sliderK.style.opacity = 1;

        updateUIReadings();
        updatePizzaColor(currentTemp);

        // Limpiar gráfico
        chart.data.datasets[0].data = [];
        chart.data.datasets[0].pointRadius = [];
        chart.update();

        btnPlayPause.innerHTML = `<span>▶</span> <span>Iniciar Tiempo</span>`;
    }

    btnPlayPause.addEventListener("click", () => {
        if (isPlaying) {
            pauseSimulation();
        } else {
            startSimulation();
        }
    });

    btnReset.addEventListener("click", resetSimulation);

    // Multiplicadores de velocidad
    speedBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            speedBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            speedMultiplier = parseInt(btn.getAttribute("data-speed"));
        });
    });

    // Iniciar partículas de vapor de la pizza
    initSteamEngine();
}


// --- MOTOR DE PARTÍCULAS DE VAPOR INTERACTIVO (CANVAS) ---
let steamParticles = [];
const maxParticles = 60;

function initSteamEngine() {
    const canvas = document.getElementById("steam-canvas");
    const ctx = canvas.getContext("2d");
    const viewport = document.getElementById("pizza-viewport");

    // Ajustar resolución del canvas
    function resizeCanvas() {
        canvas.width = viewport.clientWidth + 40;
        canvas.height = viewport.clientHeight + 40;
    }
    
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Coordenadas de mouse
    let mouse = { x: null, y: null, vx: 0, vy: 0, lastX: null, lastY: null };

    canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;

        if (mouse.lastX !== null && mouse.lastY !== null) {
            // Calcular velocidad del cursor para arrastrar el aire
            mouse.vx = (curX - mouse.lastX) * 0.15;
            mouse.vy = (curY - mouse.lastY) * 0.15;
        }

        mouse.x = curX;
        mouse.y = curY;
        mouse.lastX = curX;
        mouse.lastY = curY;
    });

    canvas.addEventListener("mouseleave", () => {
        mouse.x = null;
        mouse.y = null;
        mouse.vx = 0;
        mouse.vy = 0;
        mouse.lastX = null;
        mouse.lastY = null;
    });

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const pizzaRadius = Math.min(canvas.width, canvas.height) * 0.35;

            // Generar coordenadas circulares aleatorias sobre la pizza
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * pizzaRadius;

            this.x = centerX + Math.cos(angle) * r;
            this.y = centerY + Math.sin(angle) * r;
            
            // Tamaño y velocidad vertical ascendente
            this.size = Math.random() * 8 + 6;
            this.baseSpeedY = -(Math.random() * 0.6 + 0.3); // Ascenso
            this.vx = (Math.random() - 0.5) * 0.3; // Flujo lateral
            this.vy = this.baseSpeedY;
            
            this.alpha = 1.0;
            // Tasa de disipación basada en la vida de la partícula
            this.fade = Math.random() * 0.004 + 0.003;
        }

        update() {
            // 1. Efecto del Mouse (Convección de aire / remolino de cursor)
            if (mouse.x !== null) {
                const dx = mouse.x - this.x;
                const dy = mouse.y - this.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < 90) {
                    // Atracción sutil al campo de baja presión térmica creado por la mano
                    const force = (90 - dist) / 90;
                    this.vx += (dx / dist) * force * 0.05 + mouse.vx * 0.1;
                    this.vy += (dy / dist) * force * 0.02 + mouse.vy * 0.1;
                }
            }

            // Aplicar velocidad
            this.x += this.vx;
            this.y += this.vy;
            
            // Fricción del aire sutil
            this.vx *= 0.98;
            this.vy = this.vy * 0.95 + this.baseSpeedY * 0.05;

            // Desvanecer
            this.alpha -= this.fade;

            // Si muere, reiniciar
            if (this.alpha <= 0 || this.y < 0) {
                this.reset();
            }
        }

        draw() {
            ctx.save();
            ctx.globalAlpha = this.alpha;
            
            // Crear gradiente radial para simular vapor difuso y algodonoso
            const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
            grad.addColorStop(0, "rgba(240, 240, 240, 0.25)");
            grad.addColorStop(0.5, "rgba(242, 235, 230, 0.1)");
            grad.addColorStop(1, "rgba(255, 255, 255, 0)");

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // Inicializar vector de partículas
    for (let i = 0; i < maxParticles; i++) {
        steamParticles.push(new Particle());
    }

    // Bucle de renderizado
    function animateSteam() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // La cantidad y densidad de partículas visibles depende de la temperatura de la pizza
        // Si la pizza está fría (< 35°C), no hay vapor
        const tempCutoff = 35;
        const densityFactor = Math.min(1, Math.max(0, (currentTemp - tempCutoff) / (100 - tempCutoff)));

        // Dibujar solo la fracción correspondiente a la temperatura
        const activeCount = Math.round(maxParticles * densityFactor);

        for (let i = 0; i < activeCount; i++) {
            steamParticles[i].update();
            steamParticles[i].draw();
        }

        // Reducir la velocidad lateral del mouse con el tiempo
        mouse.vx *= 0.9;
        mouse.vy *= 0.9;

        requestAnimationFrame(animateSteam);
    }

    animateSteam();
}


// --- CALCULADORA MATEMÁTICA INTERACTIVA ---
function initMathCalculator() {
    const inpTInit = document.getElementById("calc-t-init");
    const inpTAmb = document.getElementById("calc-t-amb");
    const inpK = document.getElementById("calc-k");
    const inpTime = document.getElementById("calc-time");

    // Recalcular al cambiar cualquier entrada
    [inpTInit, inpTAmb, inpK, inpTime].forEach(input => {
        input.addEventListener("input", updateMathExplanation);
    });
}

function updateMathExplanation() {
    const tInit = parseFloat(document.getElementById("calc-t-init").value) || 90;
    const tAmb = parseFloat(document.getElementById("calc-t-amb").value) || 20;
    const k = parseFloat(document.getElementById("calc-k").value) || 0.05;
    const t = parseFloat(document.getElementById("calc-time").value) || 10;

    const calcResultTemp = document.getElementById("calc-result-temp");

    // 1. Evaluar Fórmula
    const diffTermica = tInit - tAmb;
    const exponente = -k * t;
    const factorDecay = Math.exp(exponente);
    const tempFinal = tAmb + diffTermica * factorDecay;

    // Actualizar resultado principal en UI
    calcResultTemp.innerText = `${tempFinal.toFixed(1)}°C`;

    // 2. Renderizar Explicaciones Matemáticas Dinámicas usando KaTeX
    const step1El = "math-explain-step-1";
    const step2El = "math-explain-step-2";
    const step3El = "math-explain-step-3";

    const step1Latex = `T_{\\text{inicial}} - T_{\\text{ambiente}} = ${tInit} - ${tAmb} = ${diffTermica.toFixed(1)}\\text{°C}`;
    const step2Latex = `e^{-k \\cdot t} = e^{-${k.toFixed(3)} \\cdot ${t}} = e^{${exponente.toFixed(2)}} \\approx ${factorDecay.toFixed(4)}`;
    const step3Latex = `T(${t}) = ${tAmb} + (${diffTermica.toFixed(1)}) \\cdot ${factorDecay.toFixed(4)} = ${tempFinal.toFixed(2)}\\text{°C}`;

    renderLaTeX(step1El, step1Latex);
    renderLaTeX(step2El, step2Latex);
    renderLaTeX(step3El, step3Latex);
}

// Función auxiliar para renderizar de forma segura con KaTeX
function renderLaTeX(elementId, latexStr) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (window.katex) {
        try {
            window.katex.render(latexStr, el, {
                throwOnError: false,
                displayMode: true
            });
        } catch (err) {
            el.innerHTML = `$$${latexStr}$$`;
        }
    } else {
        el.innerHTML = `$$${latexStr}$$`;
    }
}


// --- PARTÍCULAS AMBIENTALES DE FONDO (MOUSE MOVIMIENTO PARALLAX) ---
function initAmbientParticles() {
    const container = document.getElementById("ambient-particles");
    const particleCount = 20;

    // Crear partículas estáticas flotantes
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement("div");
        particle.classList.add("ambient-dot");
        
        // Atributos aleatorios
        const size = Math.random() * 60 + 40;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${Math.random() * 100}vw`;
        particle.style.top = `${Math.random() * 100}vh`;
        
        // Gradientes de color pastel muy tenues
        const colors = ["rgba(255, 181, 167, 0.08)", "rgba(255, 229, 180, 0.08)", "rgba(216, 243, 220, 0.1)"];
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.borderRadius = "50%";
        particle.style.filter = "blur(30px)";
        particle.style.position = "absolute";
        
        // Almacenar factor de movimiento parallax en variables personalizadas
        particle.setAttribute("data-depth", Math.random() * 0.04 + 0.01);
        
        container.appendChild(particle);
    }

    // Efecto Parallax sutil general y en las tarjetas
    const cards = document.querySelectorAll(".panel-card");

    document.addEventListener("mousemove", (e) => {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Mover círculos flotantes de fondo
        const dots = document.querySelectorAll(".ambient-dot");
        dots.forEach(dot => {
            const depth = parseFloat(dot.getAttribute("data-depth"));
            const moveX = (mouseX - windowWidth / 2) * depth;
            const moveY = (mouseY - windowHeight / 2) * depth;
            dot.style.transform = `translate(${moveX}px, ${moveY}px)`;
        });

        // Efecto inclinación 3D sutil (tilt) en las tarjetas del panel
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardX = rect.left + rect.width / 2;
            const cardY = rect.top + rect.height / 2;
            
            // Distancia del cursor al centro de la tarjeta (normalizada)
            const angleX = (cardY - mouseY) / (windowHeight / 2) * 2; // máx 2 grados
            const angleY = (mouseX - cardX) / (windowWidth / 2) * 2;   // máx 2 grados

            card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg) translateY(-2px)`;
        });
    });

    // Resetear transformaciones de las tarjetas cuando sale el mouse
    document.addEventListener("mouseleave", () => {
        cards.forEach(card => {
            card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)";
        });
    });
}
