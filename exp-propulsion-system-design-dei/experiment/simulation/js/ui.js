// ui.js — User Interface and Chart Render Coordinator.
// Populates selectors, handles events, and displays computed outputs.

window.UI = (function () {
  'use strict';

  let thrustChartInstance = null;

  // Builds the accordion panels for component selection dynamically.
  function buildFromDB(db) {
    _buildSection('Frame / Chassis',     db.frames,            'frame',             _frameSpecs,   false);
    _buildSection('Motor',               db.motors,            'motor',             _motorSpecs,   false);
    _buildSection('Propeller',           db.propellers,        'propeller',         _propSpecs,    false);
    _buildSection('Battery',             db.batteries,         'battery',           _battSpecs,    false);
    _buildSection('ESC',                 db.escs,              'esc',               _escSpecs,     false);
    _buildSection('Flight Controller',   db.flight_controllers,'flight_controller', _fcSpecs,      false);
    _buildSection('Receiver',            db.receivers,         'receiver',          _rxSpecs,      false);
    _buildSection('Payloads',            db.payloads,          'payload',           _payloadSpecs, true);

    _wireAltitudeSlider(db);
    updateChecklist(); // Initial run to show pending checklist
  }

  function _buildSection(title, items, category, specFn, isMulti) {
    const parent = document.getElementById('configSections');
    if (!parent) return;

    const group = document.createElement('div');
    group.className = 'config-group';
    group.id = 'group_' + category;

    const groupTitle = document.createElement('div');
    groupTitle.className = 'config-group-title';
    groupTitle.textContent = title;
    group.appendChild(groupTitle);

    const grid = document.createElement('div');
    grid.className = 'tiles-grid';
    group.appendChild(grid);

    items.forEach(function (item) {
      const tile = document.createElement('label');
      tile.className = 'component-tile';
      tile.htmlFor = 'input_' + category + '_' + item.id;

      const input = document.createElement('input');
      input.type = isMulti ? 'checkbox' : 'radio';
      input.name = 'sel_' + category;
      input.id = 'input_' + category + '_' + item.id;
      input.value = item.id;

      const labelDiv = document.createElement('div');
      labelDiv.className = 'tile-label';
      labelDiv.innerHTML =
        '<span class="tile-name">' + _escape(item.label) + '</span>' +
        '<span class="tile-spec">' + specFn(item) + '</span>';

      tile.appendChild(input);
      tile.appendChild(labelDiv);
      grid.appendChild(tile);

      input.addEventListener('change', function () {
        _handleSelectionChange(category, item, isMulti, input.checked, tile);
      });
    });

    parent.appendChild(group);
  }

  // Specification string builders 
  function _frameSpecs(f) {
    return f.wheelbase_mm + 'mm | ' + f.mass_g + 'g';
  }
  function _motorSpecs(m) {
    return m.kv + 'KV | ' + m.mass_g + 'g';
  }
  function _propSpecs(p) {
    return p.diameter_in + '" | ' + p.mass_g_each + 'g';
  }
  function _battSpecs(b) {
    return b.cells + 'S | ' + b.capacity_mah + 'mAh | ' + b.mass_g + 'g';
  }
  function _escSpecs(e) {
    return e.current_a + 'A | ' + (e.quantity === 1 ? 'Stack' : '4x') + ' | ' + (e.mass_g_each * e.quantity).toFixed(0) + 'g';
  }
  function _fcSpecs(f) {
    return f.processor + ' | ' + f.mass_g + 'g';
  }
  function _rxSpecs(r) {
    return r.protocol + ' | ' + r.mass_g + 'g';
  }
  function _payloadSpecs(p) {
    return p.mass_g + 'g';
  }

  function _handleSelectionChange(category, item, isMulti, checked, card) {
    if (!window.VLAB) return;
    const selections = window.VLAB.state.selections;

    if (isMulti) {
      if (checked) {
        if (!selections.payloads.find(p => p.id === item.id)) {
          selections.payloads.push(item);
        }
      } else {
        window.VLAB.state.selections.payloads = selections.payloads.filter(p => p.id !== item.id);
      }
    } else {
      selections[category] = item;
    }

    // Toggle active state classes on tiles visually
    const inputs = document.getElementsByName('sel_' + category);
    inputs.forEach(function (inp) {
      const tile = inp.parentNode;
      if (inp.checked) {
        tile.classList.add('active');
        tile.classList.add('selected');
      } else {
        tile.classList.remove('active');
        tile.classList.remove('selected');
      }
    });

    if (window.DroneModel) {
      window.DroneModel.updateFromSelections(selections);
    }

    resetResults();
    updateChecklist();
  }

  function updateChecklist() {
    const sel = window.VLAB && window.VLAB.state.selections;
    const container = document.getElementById('checklistContainer');
    if (!sel || !container) return;

    const items = [
      { key: 'frame',             label: 'Frame / Chassis',     desc: 'Select frame size' },
      { key: 'motor',             label: 'Brushless Motor',     desc: 'Select motor KV' },
      { key: 'propeller',         label: 'Propeller',           desc: 'Select diameter' },
      { key: 'battery',           label: 'LiPo Battery',        desc: 'Select cell count' },
      { key: 'esc',               label: 'ESC Rating',          desc: 'Select ESC rating' },
      { key: 'flight_controller', label: 'Flight Controller',   desc: 'Select processor' },
      { key: 'receiver',          label: 'Radio Receiver (RX)', desc: 'Select protocol' }
    ];

    let completeCount = 0;
    let html = '';

    // Check propeller overlap first
    let overlap = false;
    if (sel.frame && sel.propeller) {
      const wheelbase = sel.frame.wheelbase_mm;
      const diameter = sel.propeller.diameter_m * 1000.0;
      const maxDia = wheelbase / Math.sqrt(2);
      if (diameter > maxDia) {
        overlap = true;
      }
    }

    items.forEach(function (item) {
      const selectedItem = sel[item.key];
      const isDone = !!selectedItem && !(item.key === 'propeller' && overlap);
      if (isDone) completeCount++;

      const icon = isDone ? '<span class="chk-icon done">✓</span>' : '<span class="chk-icon pending"></span>';
      const name = selectedItem ? selectedItem.label : item.desc;

      html += 
        '<div class="checklist-item">' +
          icon +
          '<span class="checklist-label">' + item.label + '</span>' +
          '<span class="checklist-val">' + name + '</span>' +
        '</div>';
    });

    container.innerHTML = html;

    const overlapCard = document.getElementById('overlapWarningCard');
    if (overlapCard) {
      if (overlap) {
        const wheelbase = sel.frame.wheelbase_mm;
        const propDiaIn = sel.propeller.diameter_in;
        const propDiaMm = (sel.propeller.diameter_m * 1000).toFixed(0);
        const maxDiaMm = (wheelbase / Math.sqrt(2)).toFixed(0);
        const maxDiaIn = (wheelbase / Math.sqrt(2) / 25.4).toFixed(1);

        overlapCard.style.display = 'block';
        overlapCard.innerHTML = 
          '<strong>Propeller Collision Warning</strong>' +
          'Selected ' + propDiaIn + '" propellers (' + propDiaMm + 'mm diameter) will overlap and collide on a ' + 
          wheelbase + 'mm wheelbase frame. Max allowable propeller size is ' + maxDiaIn + '" (' + maxDiaMm + 'mm) to prevent blade overlap. ' +
          'Please choose a larger frame or smaller propeller.';
      } else {
        overlapCard.style.display = 'none';
      }
    }

    const btn = document.getElementById('btnFinalizeAssembly');
    if (btn) {
      btn.disabled = !(completeCount === items.length);
    }
  }

  function _wireAltitudeSlider(db) {
    const slider = document.getElementById('altitudeSlider');
    const valText = document.getElementById('altitudeValue');
    const densText = document.getElementById('densityValue');
    if (!slider) return;

    function handleInput() {
      const alt = parseInt(slider.value, 10);
      const rho = Calc.airDensity(alt);
      if (window.VLAB) {
        window.VLAB.state.altitude_m = alt;
        window.VLAB.state.rho = rho;
      }
      if (valText) valText.textContent = alt + ' m';
      if (densText) densText.textContent = rho.toFixed(4);

      const pct = (alt / 3000) * 100;
      slider.style.background = 'linear-gradient(to right, #2563eb ' + pct + '%, #e5e7eb ' + pct + '%)';
    }

    slider.addEventListener('input', handleInput);
    handleInput();
  }

  // showMassBudget 
  function showMassBudget(budget) {
    const tbody = document.getElementById('budgetBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    budget.breakdown.forEach(function (row) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + _escape(row.label) + '</td>' +
        '<td>' + row.quantity + '</td>' +
        '<td>' + row.unit_g.toFixed(1) + '</td>' +
        '<td>' + row.total_g.toFixed(1) + '</td>';
      tbody.appendChild(tr);
    });

    const totalCell = document.getElementById('totalMassCell');
    if (totalCell) totalCell.textContent = budget.total_g.toFixed(1) + ' g';

    const div = document.getElementById('massBudget');
    if (div) div.style.display = '';
  }

  // showCalcResults 
  function showCalcResults(r) {
    const calcPanel = document.getElementById('calculationsPanel');
    const resultsSec = document.getElementById('resultsSection');

    if (calcPanel) calcPanel.style.display = '';
    if (resultsSec) resultsSec.style.display = '';

    const rps = r.op_point ? r.op_point.rpm / 60.0 : 100;

    document.getElementById('calcA_eval').innerHTML =
      'T_req = (' + r.mass_kg.toFixed(4) + ' kg &times; 9.80665 m/s&sup2;) / 4 = ' + r.T_required_n.toFixed(4) + ' N per motor';

    document.getElementById('calcB_eval').innerHTML =
      'T_aero = ' + Calc.Ct.toFixed(5) + ' &times; ' + r.rho.toFixed(4) + ' kg/m&sup3; &times; (' +
      rps.toFixed(1) + ' rps)&sup2; &times; (' + r.sel.propeller.diameter_m.toFixed(4) + ' m)<sup>4</sup> = ' + r.T_aero_n.toFixed(4) + ' N';

    document.getElementById('sumMass').textContent = r.mass_kg.toFixed(4) + ' kg';
    document.getElementById('sumReqThrust').textContent = r.T_required_n.toFixed(4) + ' N';
    document.getElementById('sumAeroThrust').textContent = r.T_aero_n.toFixed(4) + ' N';

    const marginCard = document.getElementById('sumMarginCard');
    const marginVal = document.getElementById('sumMarginVal');
    const marginDesc = document.getElementById('sumMarginDesc');

    if (marginCard && marginVal && marginDesc) {
      marginCard.className = 'summary-card margin-card';
      const rating = r.margin.rating;
      if (rating === 'EXCELLENT' || rating === 'GOOD') {
        marginCard.classList.add('pass-good');
      } else if (rating === 'MARGINAL') {
        marginCard.classList.add('pass-marginal');
      } else {
        marginCard.classList.add('fail');
      }
      marginVal.textContent = rating + ' (' + r.margin.margin_ratio.toFixed(2) + ':1)';
      marginDesc.textContent = r.margin.margin_pct.toFixed(1) + '% safety margin (Min req: 30%)';
    }

    const mins = (r.flight_time.flight_time_s / 60.0).toFixed(1);
    document.getElementById('sumHoverTime').textContent = mins + ' min (' + r.flight_time.flight_time_s.toFixed(0) + ' s)';
  }

  // showThrustChart 
  function showThrustChart(sweepData, T_req, targetRPM) {
    const canvas = document.getElementById('thrustChart');
    if (!canvas) return;

    const desc = document.getElementById('chartDescRPM');
    if (desc && targetRPM) {
      desc.innerHTML = 'Fixed RPM = ' + Math.round(targetRPM) + '. Shows quartic relationship (D<sup>4</sup>)';
    }

    if (thrustChartInstance) {
      thrustChartInstance.destroy();
      thrustChartInstance = null;
    }

    const labels = sweepData.map(d => d.diameter_in.toFixed(1) + '"');
    const thrusts = sweepData.map(d => d.thrust_n);

    thrustChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Aerodynamic Thrust (N)',
            data: thrusts,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#2563eb',
            fill: true,
            tension: 0.2
          },
          {
            label: 'Required Thrust (N)',
            data: labels.map(() => T_req),
            borderColor: '#ef4444',
            borderWidth: 1.5,
            borderDash: [4, 3],
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
            position: 'bottom',
            labels: { font: { family: 'Inter', size: 10 }, boxWidth: 10, padding: 6 }
          }
        },
        scales: {
          x: {
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 9 } }
          },
          y: {
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 9 } }
          }
        }
      }
    });
  }

  function resetResults() {
    const budgetDiv = document.getElementById('massBudget');
    const simControls = document.getElementById('simControls');
    const simHud = document.getElementById('simHud');

    if (budgetDiv) budgetDiv.style.display = 'none';
    if (simControls) simControls.style.display = 'none';
    if (simHud) simHud.style.display = 'none';

    const placeholders = ['calcA_eval', 'calcB_eval', 'sumMass', 'sumReqThrust', 'sumAeroThrust', 'sumHoverTime'];
    placeholders.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });

    const marginVal = document.getElementById('sumMarginVal');
    const marginDesc = document.getElementById('sumMarginDesc');
    const marginCard = document.getElementById('sumMarginCard');
    if (marginVal) marginVal.textContent = '—';
    if (marginDesc) marginDesc.textContent = 'T_aero / T_req';
    if (marginCard) {
      marginCard.className = 'summary-card margin-card';
    }

    const tab2 = document.getElementById('tabAeroBtn');
    const tab3 = document.getElementById('tabHoverBtn');
    if (tab2) tab2.disabled = true;
    if (tab3) tab3.disabled = true;

    if (thrustChartInstance) {
      thrustChartInstance.destroy();
      thrustChartInstance = null;
    }
  }

  function _escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    buildFromDB: buildFromDB,
    updateChecklist: updateChecklist,
    showMassBudget: showMassBudget,
    showCalcResults: showCalcResults,
    showThrustChart: showThrustChart,
    resetResults: resetResults
  };
})();
