const OUTPUT_LEN: usize = 4096;
const MAX_COLS: usize = 64;
const MAX_ROWS: usize = 64;
const MAX_SIDE_SEGMENTS: usize = 64;
const MAX_CELLS: usize = 256;
const MAX_MATERIALS: usize = 64;

const COLS_OFFSET: usize = 64;
const ROWS_OFFSET: usize = 128;
const CELLS_OFFSET: usize = 192;
const CELL_STRIDE: usize = 6;
const MATERIALS_OFFSET: usize = 1800;
const MATERIAL_STRIDE: usize = 6;

const ORIENTATION_NORMAL: i32 = 0;
const ORIENTATION_ROTATED: i32 = 1;

const FOOT_STECK: i32 = 0;

const MOUNT_START: i32 = 0;
const MOUNT_RIGHT: i32 = 1;
const MOUNT_BACK: i32 = 2;
const MOUNT_OTHER: i32 = 3;
const TYPE_SPECIAL: i32 = 4;
const TYPE_SPECIAL_05: i32 = 5;

const GROUP_PODESTE: i32 = 1;
const GROUP_FEET: i32 = 2;
const GROUP_BRACING: i32 = 3;
const GROUP_RAILING: i32 = 4;
const GROUP_RAILING_ACCESSORIES: i32 = 5;

const ARTICLE_PODEST_2X1: i32 = 1;
const ARTICLE_PODEST_2X05: i32 = 2;
const ARTICLE_PODEST_1X1: i32 = 3;
const ARTICLE_PODEST_1X05: i32 = 4;
const ARTICLE_STECK_FEST: i32 = 5;
const ARTICLE_STECK_SPINDEL: i32 = 6;
const ARTICLE_LAYHER_SPINDEL: i32 = 7;
const ARTICLE_RAIL_185: i32 = 11;
const ARTICLE_RAIL_85: i32 = 12;
const ARTICLE_RAIL_50: i32 = 13;
const ARTICLE_BOLZEN: i32 = 14;
const ARTICLE_ADAPTER: i32 = 15;
const ARTICLE_VERBINDER: i32 = 16;
const ARTICLE_ECKVERBINDER: i32 = 17;
const ARTICLE_BRACING_DIAGONAL_SCHEMA: i32 = 18;
const ARTICLE_BRACING_HORIZONTAL_SCHEMA: i32 = 19;

const UNIT_STK: i32 = 1;
const UNIT_SCHEMA: i32 = 2;

const BRACING_NONE: i32 = 0;
const BRACING_DIAGONAL: i32 = 1;
const BRACING_HORIZONTAL_AND_DIAGONAL: i32 = 2;
const BRACING_UNSUPPORTED: i32 = 3;

static mut OUTPUT: [i32; OUTPUT_LEN] = [0; OUTPUT_LEN];

#[derive(Clone, Copy)]
struct Score {
    count_2x1: i32,
    count_other: i32,
}

#[derive(Clone, Copy)]
struct Cell {
    row: i32,
    col: i32,
    row_span: i32,
    width_half: i32,
    depth_half: i32,
    cell_type: i32,
}

#[derive(Clone, Copy)]
struct RailMaterial {
    rail_185: i32,
    rail_85: i32,
    rail_50: i32,
    bolzen: i32,
    adapter: i32,
    verbinder: i32,
    eckverbinder: i32,
}

#[no_mangle]
pub extern "C" fn output_len() -> usize {
    OUTPUT_LEN
}

#[no_mangle]
pub extern "C" fn calculate(
    width_half: i32,
    depth_half: i32,
    orientation: i32,
    foot_type: i32,
    height_cm: i32,
    use_special: i32,
    rails_mask: i32,
) -> *const i32 {
    let width_half = clamp(width_half, 1, 40);
    let depth_half = clamp(depth_half, 1, 24);
    let orientation = if orientation == ORIENTATION_ROTATED {
        ORIENTATION_ROTATED
    } else {
        ORIENTATION_NORMAL
    };

    let mut normal_cols = [0; MAX_COLS];
    let mut normal_rows = [0; MAX_ROWS];
    let normal_cols_len = split_width_normal(width_half, &mut normal_cols);
    let normal_rows_len = split_depth_normal(depth_half, &mut normal_rows);
    let normal = score(
        &normal_cols[..normal_cols_len],
        &normal_rows[..normal_rows_len],
    );

    let mut rotated_cols = [0; MAX_COLS];
    let mut rotated_rows = [0; MAX_ROWS];
    let rotated_cols_len = split_width_rotated(width_half, &mut rotated_cols);
    let rotated_rows_len = split_depth_rotated(depth_half, &mut rotated_rows);
    let rotated = score(
        &rotated_cols[..rotated_cols_len],
        &rotated_rows[..rotated_rows_len],
    );
    let recommended = recommended_orientation(normal, rotated);

    let mut cols = [0; MAX_COLS];
    let mut rows = [0; MAX_ROWS];
    let (cols_len, rows_len) = if orientation == ORIENTATION_ROTATED {
        let cols_len = split_width_rotated(width_half, &mut cols);
        let rows_len = split_depth_rotated(depth_half, &mut rows);
        (cols_len, rows_len)
    } else {
        let cols_len = split_width_normal(width_half, &mut cols);
        let rows_len = split_depth_normal(depth_half, &mut rows);
        (cols_len, rows_len)
    };

    let special_available = width_half % 4 == 1 || width_half % 4 == 3;
    let invalid_corner = (width_half % 4 == 1 || width_half % 4 == 3) && depth_half % 2 == 1;

    let mut cells = [Cell {
        row: 0,
        col: 0,
        row_span: 1,
        width_half: 0,
        depth_half: 0,
        cell_type: MOUNT_OTHER,
    }; MAX_CELLS];
    let cell_count = build_cells(
        &cols[..cols_len],
        &rows[..rows_len],
        use_special != 0 && special_available,
        &mut cells,
    );

    let (foot_base, sp_size) = foot_spec(height_cm, foot_type);
    let bracing_mode = bracing_mode(height_cm);
    let diagonal_length = diagonal_length_mm(height_cm);
    let rail = rail_material(&cols[..cols_len], &rows[..rows_len], rails_mask);
    let feet_total = cells[..cell_count]
        .iter()
        .map(|cell| foot_count_for_cell(*cell, rows_len as i32, cols_len as i32))
        .sum::<i32>();

    unsafe {
        let output_ptr = core::ptr::addr_of_mut!(OUTPUT).cast::<i32>();
        for index in 0..OUTPUT_LEN {
            output_ptr.add(index).write(0);
        }
        OUTPUT[0] = width_half;
        OUTPUT[1] = depth_half;
        OUTPUT[2] = width_half * depth_half;
        OUTPUT[3] = cols_len as i32;
        OUTPUT[4] = rows_len as i32;
        OUTPUT[5] = cell_count as i32;
        OUTPUT[6] = feet_total;
        OUTPUT[7] = bracing_mode;
        OUTPUT[8] = recommended;
        OUTPUT[9] = normal.count_2x1;
        OUTPUT[10] = normal.count_other;
        OUTPUT[11] = rotated.count_2x1;
        OUTPUT[12] = rotated.count_other;
        OUTPUT[13] = rail.rail_185;
        OUTPUT[14] = rail.rail_85;
        OUTPUT[15] = rail.rail_50;
        OUTPUT[16] = rail.bolzen;
        OUTPUT[17] = rail.adapter;
        OUTPUT[18] = rail.verbinder;
        OUTPUT[19] = rail.eckverbinder;
        OUTPUT[21] = foot_base;
        OUTPUT[22] = sp_size;
        OUTPUT[23] = if invalid_corner { 1 } else { 0 };
        OUTPUT[24] = if special_available { 1 } else { 0 };
        OUTPUT[25] = orientation;
        OUTPUT[26] = diagonal_length;
        OUTPUT[27] = if width_half < 12 || depth_half < 12 {
            1
        } else {
            0
        };

        for (index, col) in cols[..cols_len].iter().enumerate() {
            OUTPUT[COLS_OFFSET + index] = *col;
        }
        for (index, row) in rows[..rows_len].iter().enumerate() {
            OUTPUT[ROWS_OFFSET + index] = *row;
        }
        for (index, cell) in cells[..cell_count].iter().enumerate() {
            let offset = CELLS_OFFSET + index * CELL_STRIDE;
            OUTPUT[offset] = cell.row;
            OUTPUT[offset + 1] = cell.col;
            OUTPUT[offset + 2] = cell.row_span;
            OUTPUT[offset + 3] = cell.width_half;
            OUTPUT[offset + 4] = cell.depth_half;
            OUTPUT[offset + 5] = cell.cell_type;
        }

        let material_count = write_materials(
            &cells[..cell_count],
            rows_len as i32,
            cols_len as i32,
            foot_type,
            foot_base,
            sp_size,
            feet_total,
            bracing_mode,
            diagonal_length,
            rail,
        );
        OUTPUT[20] = material_count as i32;
        core::ptr::addr_of!(OUTPUT).cast::<i32>()
    }
}

fn clamp(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn push(buffer: &mut [i32], len: &mut usize, value: i32) {
    if *len < buffer.len() {
        buffer[*len] = value;
        *len += 1;
    }
}

fn split_width_normal(width_half: i32, out: &mut [i32]) -> usize {
    let full = width_half / 4;
    let rest = width_half - full * 4;
    let mut len = 0;
    if rest >= 3 {
        push(out, &mut len, 1);
        push(out, &mut len, 2);
    } else if rest >= 2 {
        push(out, &mut len, 2);
    } else if rest >= 1 {
        push(out, &mut len, 1);
    }
    for _ in 0..full {
        push(out, &mut len, 4);
    }
    len
}

fn split_depth_normal(depth_half: i32, out: &mut [i32]) -> usize {
    let full = depth_half / 2;
    let rest = depth_half - full * 2;
    let mut len = 0;
    for _ in 0..full {
        push(out, &mut len, 2);
    }
    if rest >= 1 {
        push(out, &mut len, rest);
    }
    len
}

fn split_width_rotated(width_half: i32, out: &mut [i32]) -> usize {
    let full = width_half / 2;
    let rest = width_half - full * 2;
    let mut len = 0;
    if rest >= 1 {
        push(out, &mut len, rest);
    }
    for _ in 0..full {
        push(out, &mut len, 2);
    }
    len
}

fn split_depth_rotated(depth_half: i32, out: &mut [i32]) -> usize {
    let full = depth_half / 4;
    let rest = depth_half - full * 4;
    let mut len = 0;
    for _ in 0..full {
        push(out, &mut len, 4);
    }
    if rest >= 3 {
        push(out, &mut len, 2);
        push(out, &mut len, 1);
    } else if rest >= 2 {
        push(out, &mut len, 2);
    } else if rest >= 1 {
        push(out, &mut len, 1);
    }
    len
}

fn score(cols: &[i32], rows: &[i32]) -> Score {
    let mut count_2x1 = 0;
    let mut count_other = 0;
    for col in cols {
        for row in rows {
            if (*col == 4 && *row == 2) || (*col == 2 && *row == 4) {
                count_2x1 += 1;
            } else {
                count_other += 1;
            }
        }
    }
    Score {
        count_2x1,
        count_other,
    }
}

fn recommended_orientation(normal: Score, rotated: Score) -> i32 {
    if rotated.count_other < normal.count_other {
        ORIENTATION_ROTATED
    } else if normal.count_other < rotated.count_other {
        ORIENTATION_NORMAL
    } else if rotated.count_2x1 > normal.count_2x1 {
        ORIENTATION_ROTATED
    } else {
        ORIENTATION_NORMAL
    }
}

fn mount_kind(row: i32, col: i32, _rows: i32, cols: i32) -> i32 {
    if row == 0 && col == cols - 1 {
        MOUNT_START
    } else if col == cols - 1 {
        MOUNT_RIGHT
    } else if row == 0 {
        MOUNT_BACK
    } else {
        MOUNT_OTHER
    }
}

fn build_cells(cols: &[i32], rows: &[i32], use_special: bool, out: &mut [Cell]) -> usize {
    let has_rest_column = cols.first().is_some_and(|first| *first == 1 || *first == 2);
    let mut skipped = [[false; MAX_COLS]; MAX_ROWS];
    let mut len = 0;
    for row in 0..rows.len() {
        for col in 0..cols.len() {
            if skipped[row][col] || len >= out.len() {
                continue;
            }
            let can_span = use_special
                && col == 0
                && has_rest_column
                && row + 1 < rows.len()
                && rows[row] == 2
                && rows[row + 1] == 2;
            if can_span {
                out[len] = Cell {
                    row: row as i32,
                    col: col as i32,
                    row_span: 2,
                    width_half: cols[col],
                    depth_half: 4,
                    cell_type: if cols[col] == 2 {
                        TYPE_SPECIAL
                    } else {
                        TYPE_SPECIAL_05
                    },
                };
                skipped[row + 1][col] = true;
            } else {
                out[len] = Cell {
                    row: row as i32,
                    col: col as i32,
                    row_span: 1,
                    width_half: cols[col],
                    depth_half: rows[row],
                    cell_type: mount_kind(
                        row as i32,
                        col as i32,
                        rows.len() as i32,
                        cols.len() as i32,
                    ),
                };
            }
            len += 1;
        }
    }
    len
}

fn foot_count_for_kind(kind: i32) -> i32 {
    match kind {
        MOUNT_START => 4,
        MOUNT_RIGHT | MOUNT_BACK => 2,
        _ => 1,
    }
}

fn foot_count_for_cell(cell: Cell, rows: i32, cols: i32) -> i32 {
    if cell.cell_type == TYPE_SPECIAL || cell.cell_type == TYPE_SPECIAL_05 {
        foot_count_for_kind(mount_kind(cell.row, cell.col, rows, cols))
    } else {
        foot_count_for_kind(cell.cell_type)
    }
}

fn foot_spec(height_cm: i32, foot_type: i32) -> (i32, i32) {
    if foot_type == FOOT_STECK {
        return (height_cm, 0);
    }
    let heights = [20, 40, 60, 80, 100, 120];
    let mut base = heights[0];
    for height in heights {
        if height < height_cm {
            base = height;
        }
    }
    (base, base.min(80))
}

fn bracing_mode(height_cm: i32) -> i32 {
    if height_cm < 80 {
        BRACING_NONE
    } else if height_cm <= 140 {
        BRACING_DIAGONAL
    } else if height_cm <= 200 {
        BRACING_HORIZONTAL_AND_DIAGONAL
    } else {
        BRACING_UNSUPPORTED
    }
}

fn diagonal_length_mm(height_cm: i32) -> i32 {
    if height_cm < 80 {
        0
    } else if height_cm <= 100 {
        2250
    } else if height_cm <= 140 {
        2400
    } else if height_cm <= 180 {
        2500
    } else if height_cm <= 200 {
        2750
    } else {
        0
    }
}

fn has_mount_slot(kind: i32, slot: i32) -> bool {
    match kind {
        MOUNT_START => matches!(slot, 0 | 1 | 2 | 3),
        MOUNT_RIGHT => matches!(slot, 2 | 3),
        MOUNT_BACK => matches!(slot, 0 | 2),
        _ => slot == 2,
    }
}

fn add_rail_segment(result: &mut RailMaterial, width_half: i32) {
    if width_half >= 4 {
        result.rail_185 += 1;
    } else if width_half >= 2 {
        result.rail_85 += 1;
    } else if width_half >= 1 {
        result.rail_50 += 1;
    }
    result.bolzen += 2;
}

fn add_rail_side(
    result: &mut RailMaterial,
    segments: &[(i32, i32, i32)],
    first_slot: i32,
    last_slot: i32,
    rows_len: i32,
    cols_len: i32,
) {
    let mut groups = 0;
    let mut index = 0;
    while index < segments.len() {
        let current = segments[index];
        let next = segments.get(index + 1).copied();
        let (first, last, width, advance) =
            if current.2 == 2 && next.is_some_and(|item| item.2 == 2) {
                (current, next.unwrap(), 4, 2)
            } else {
                (current, current, current.2, 1)
            };
        add_rail_segment(result, width);
        if !has_mount_slot(mount_kind(first.0, first.1, rows_len, cols_len), first_slot) {
            result.adapter += 1;
        }
        if !has_mount_slot(mount_kind(last.0, last.1, rows_len, cols_len), last_slot) {
            result.adapter += 1;
        }
        groups += 1;
        index += advance;
    }
    if groups > 1 {
        result.verbinder += groups - 1;
    }
}

fn rail_material(cols: &[i32], rows: &[i32], rails_mask: i32) -> RailMaterial {
    let mut result = RailMaterial {
        rail_185: 0,
        rail_85: 0,
        rail_50: 0,
        bolzen: 0,
        adapter: 0,
        verbinder: 0,
        eckverbinder: 0,
    };
    let rows_len = rows.len() as i32;
    let cols_len = cols.len() as i32;
    let mut segments = [(0, 0, 0); MAX_SIDE_SEGMENTS];

    if rails_mask & 1 != 0 {
        for (col, width) in cols.iter().enumerate() {
            segments[col] = (0, col as i32, *width);
        }
        add_rail_side(
            &mut result,
            &segments[..cols.len()],
            0,
            1,
            rows_len,
            cols_len,
        );
    }
    if rails_mask & 2 != 0 {
        for (col, width) in cols.iter().enumerate() {
            segments[col] = (rows_len - 1, col as i32, *width);
        }
        add_rail_side(
            &mut result,
            &segments[..cols.len()],
            2,
            3,
            rows_len,
            cols_len,
        );
    }
    if rails_mask & 4 != 0 {
        for (row, width) in rows.iter().enumerate() {
            segments[row] = (row as i32, 0, *width);
        }
        add_rail_side(
            &mut result,
            &segments[..rows.len()],
            0,
            2,
            rows_len,
            cols_len,
        );
    }
    if rails_mask & 8 != 0 {
        for (row, width) in rows.iter().enumerate() {
            segments[row] = (row as i32, cols_len - 1, *width);
        }
        add_rail_side(
            &mut result,
            &segments[..rows.len()],
            1,
            3,
            rows_len,
            cols_len,
        );
    }

    let active_corners = [
        rails_mask & 1 != 0 && rails_mask & 4 != 0,
        rails_mask & 1 != 0 && rails_mask & 8 != 0,
        rails_mask & 2 != 0 && rails_mask & 4 != 0,
        rails_mask & 2 != 0 && rails_mask & 8 != 0,
    ]
    .iter()
    .filter(|active| **active)
    .count() as i32;

    result.eckverbinder = active_corners * 2;
    result.bolzen -= active_corners;
    result.adapter = (result.adapter - active_corners).max(0);
    result
}

fn material_key(width_half: i32, depth_half: i32) -> i32 {
    let long = width_half.max(depth_half);
    let short = width_half.min(depth_half);
    match (long, short) {
        (4, 2) => ARTICLE_PODEST_2X1,
        (4, 1) => ARTICLE_PODEST_2X05,
        (2, 2) => ARTICLE_PODEST_1X1,
        (2, 1) => ARTICLE_PODEST_1X05,
        _ => 0,
    }
}

unsafe fn push_material(
    pos: &mut i32,
    count: &mut usize,
    article: i32,
    art_code: i32,
    qty: i32,
    unit: i32,
    group: i32,
) {
    if qty <= 0 || *count >= MAX_MATERIALS {
        return;
    }
    *pos += 1;
    let offset = MATERIALS_OFFSET + *count * MATERIAL_STRIDE;
    OUTPUT[offset] = *pos;
    OUTPUT[offset + 1] = article;
    OUTPUT[offset + 2] = art_code;
    OUTPUT[offset + 3] = qty;
    OUTPUT[offset + 4] = unit;
    OUTPUT[offset + 5] = group;
    *count += 1;
}

unsafe fn write_materials(
    cells: &[Cell],
    rows_len: i32,
    cols_len: i32,
    foot_type: i32,
    foot_base: i32,
    sp_size: i32,
    feet_total: i32,
    bracing_mode: i32,
    diagonal_length: i32,
    rail: RailMaterial,
) -> usize {
    let mut counts = [0; 5];
    for cell in cells {
        let key = material_key(cell.width_half, cell.depth_half);
        if key > 0 {
            counts[key as usize] += 1;
        }
    }

    let mut count = 0;
    let mut pos = 0;
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_PODEST_2X1,
        0,
        counts[ARTICLE_PODEST_2X1 as usize],
        UNIT_STK,
        GROUP_PODESTE,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_PODEST_2X05,
        0,
        counts[ARTICLE_PODEST_2X05 as usize],
        UNIT_STK,
        GROUP_PODESTE,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_PODEST_1X1,
        0,
        counts[ARTICLE_PODEST_1X1 as usize],
        UNIT_STK,
        GROUP_PODESTE,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_PODEST_1X05,
        0,
        counts[ARTICLE_PODEST_1X05 as usize],
        UNIT_STK,
        GROUP_PODESTE,
    );

    if foot_type == FOOT_STECK {
        push_material(
            &mut pos,
            &mut count,
            ARTICLE_STECK_FEST,
            foot_base,
            feet_total,
            UNIT_STK,
            GROUP_FEET,
        );
    } else {
        push_material(
            &mut pos,
            &mut count,
            ARTICLE_STECK_SPINDEL,
            foot_base,
            feet_total,
            UNIT_STK,
            GROUP_FEET,
        );
        push_material(
            &mut pos,
            &mut count,
            ARTICLE_LAYHER_SPINDEL,
            sp_size,
            feet_total,
            UNIT_STK,
            GROUP_FEET,
        );
    }

    if bracing_mode == BRACING_DIAGONAL || bracing_mode == BRACING_HORIZONTAL_AND_DIAGONAL {
        push_material(
            &mut pos,
            &mut count,
            ARTICLE_BRACING_DIAGONAL_SCHEMA,
            diagonal_length,
            1,
            UNIT_SCHEMA,
            GROUP_BRACING,
        );
    }
    if bracing_mode == BRACING_HORIZONTAL_AND_DIAGONAL {
        push_material(
            &mut pos,
            &mut count,
            ARTICLE_BRACING_HORIZONTAL_SCHEMA,
            0,
            1,
            UNIT_SCHEMA,
            GROUP_BRACING,
        );
    }

    push_material(
        &mut pos,
        &mut count,
        ARTICLE_RAIL_185,
        0,
        rail.rail_185,
        UNIT_STK,
        GROUP_RAILING,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_RAIL_85,
        0,
        rail.rail_85,
        UNIT_STK,
        GROUP_RAILING,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_RAIL_50,
        0,
        rail.rail_50,
        UNIT_STK,
        GROUP_RAILING,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_BOLZEN,
        310010,
        rail.bolzen,
        UNIT_STK,
        GROUP_RAILING_ACCESSORIES,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_ADAPTER,
        310200,
        rail.adapter,
        UNIT_STK,
        GROUP_RAILING_ACCESSORIES,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_VERBINDER,
        310100,
        rail.verbinder,
        UNIT_STK,
        GROUP_RAILING_ACCESSORIES,
    );
    push_material(
        &mut pos,
        &mut count,
        ARTICLE_ECKVERBINDER,
        310210,
        rail.eckverbinder,
        UNIT_STK,
        GROUP_RAILING_ACCESSORIES,
    );

    let _ = (rows_len, cols_len);
    count
}
