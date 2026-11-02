# -*- coding: utf-8 -*-
"""
Helper module mở rộng cho việc định dạng tài liệu Word Kịch bản Demo JobFind
Có hỗ trợ:
- Sơ đồ hoạt động dạng text diagram (Consolas)
- Khối code minh họa cú pháp thực tế (Syntax styled container)
- Khối kỹ thuật tích hợp chuyên sâu (Tech Integration Box)
"""

import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    """Đặt màu nền cho ô trong bảng"""
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    cell._tc.get_or_add_tcPr().append(shading)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    """Đặt padding cho ô trong bảng (đơn vị dxa: 20 dxa = 1 pt)"""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
    tcPr.append(tcMar)

def set_table_borders(table, color="D1D5DB", sz="4", val="single"):
    """Đặt viền thanh lịch cho toàn bảng"""
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'  <w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:insideV w:val="none"/>'
        f'  <w:left w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def add_callout(doc, text, title="LỜI THOẠI THUYẾT MINH (GỢI Ý)", box_type="script"):
    """Thêm khung ghi chú / lời thoại thuyết trình nổi bật"""
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.7)
    
    if box_type == "script":
        bg_color = "FFFBEB"      # Vàng hổ phách nhạt
        border_color = "D97706"  # Hổ phách đậm
        title_color = RGBColor(180, 83, 9)
        icon = "🎤 "
    elif box_type == "tech":
        bg_color = "F0FDF4"      # Xanh ngọc nhạt
        border_color = "059669"  # Xanh ngọc đậm
        title_color = RGBColor(4, 120, 87)
        icon = "💡 "
    elif box_type == "important":
        bg_color = "FEF2F2"      # Đỏ hồng nhạt
        border_color = "DC2626"  # Đỏ đậm
        title_color = RGBColor(185, 28, 28)
        icon = "⚠️ "
    else:
        bg_color = "EFF6FF"      # Xanh dương nhạt
        border_color = "2563EB"  # Xanh dương đậm
        title_color = RGBColor(29, 78, 216)
        icon = "📌 "

    set_cell_background(cell, bg_color)
    set_cell_margins(cell, top=120, bottom=120, left=180, right=180)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'  <w:left w:val="single" w:sz="24" w:space="0" w:color="{border_color}"/>'
        f'  <w:top w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'  <w:bottom w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(3)
    run_title = p.add_run(f"{icon}{title}\n")
    run_title.font.name = "Segoe UI"
    run_title.font.size = Pt(9.5)
    run_title.font.bold = True
    run_title.font.color.rgb = title_color
    
    run_body = p.add_run(text)
    run_body.font.name = "Segoe UI"
    run_body.font.size = Pt(9.5)
    run_body.font.italic = True if box_type == "script" else False
    run_body.font.color.rgb = RGBColor(31, 41, 55)

    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def add_diagram(doc, diagram_text, title="SƠ ĐỒ HOẠT ĐỘNG & LUỒNG DỮ LIỆU"):
    """Thêm khung vẽ sơ đồ hoạt động dạng ASCII text diagram chuẩn monospace"""
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.7)
    
    set_cell_background(cell, "F8FAFC") # Xám sáng Slate 50
    set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'  <w:left w:val="single" w:sz="18" w:space="0" w:color="0284C7"/>' # Cyan border
        f'  <w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
        f'  <w:right w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
        f'  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.05
    
    r_title = p.add_run(f"📊 {title.upper()}\n")
    r_title.font.name = "Segoe UI"
    r_title.font.size = Pt(9.5)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(2, 132, 199) # Sky Blue
    
    r_body = p.add_run(diagram_text.strip())
    r_body.font.name = "Consolas"
    r_body.font.size = Pt(8.5)
    r_body.font.color.rgb = RGBColor(15, 23, 42) # Slate 900
    
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def add_code_snippet(doc, code_text, title="CODE MINH HỌA TRIỂN KHAI THỰC TẾ"):
    """Thêm khung hiển thị code minh họa với nền tối (Dark Theme) chuẩn IDE"""
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.7)
    
    set_cell_background(cell, "0F172A") # Slate 900
    set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'  <w:left w:val="single" w:sz="18" w:space="0" w:color="10B981"/>' # Emerald border
        f'  <w:top w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'  <w:bottom w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.05
    
    r_title = p.add_run(f"💻 {title.upper()}\n")
    r_title.font.name = "Segoe UI"
    r_title.font.size = Pt(9)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(52, 211, 153) # Mint green
    
    r_code = p.add_run(code_text.strip())
    r_code.font.name = "Consolas"
    r_code.font.size = Pt(8)
    r_code.font.color.rgb = RGBColor(241, 245, 249) # White / Light slate
    
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def add_tech_integration_box(doc, feature_name, tech_stack, architecture, api_endpoints, data_flow):
    """
    Thêm khung 'HƯỚNG LÀM & CƠ CHẾ KỸ THUẬT TÍCH HỢP' chi tiết chuyên sâu
    """
    tbl = doc.add_table(rows=5, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(tbl, color="CBD5E1", sz="6")
    
    # Header ô tiêu đề
    c_hdr = tbl.cell(0, 0)
    c_hdr.width = Inches(6.7)
    set_cell_background(c_hdr, "0F172A") # Slate dark 900
    set_cell_margins(c_hdr, top=120, bottom=120, left=160, right=160)
    p_hdr = c_hdr.paragraphs[0]
    p_hdr.paragraph_format.space_before = Pt(0)
    p_hdr.paragraph_format.space_after = Pt(0)
    r_hdr = p_hdr.add_run(f"⚙️ HƯỚNG LÀM & CƠ CHẾ KỸ THUẬT: {feature_name.upper()}")
    r_hdr.font.name = "Segoe UI"
    r_hdr.font.size = Pt(10)
    r_hdr.font.bold = True
    r_hdr.font.color.rgb = RGBColor(248, 250, 252) # White
    
    sections = [
        ("🛠️ Công Nghệ & Thư Viện Sử Dụng:", tech_stack, "F8FAFC"),
        ("🔄 Kiến Trúc & Luồng Dữ Liệu (Workflow):", architecture, "FFFFFF"),
        ("🌐 API Endpoints & Giao Thức (Contracts):", api_endpoints, "F8FAFC"),
        ("🗄️ Cơ Sở Dữ Liệu & Xử Lý Bất Đồng Bộ:", data_flow, "FFFFFF")
    ]
    
    for idx, (label, content, bg) in enumerate(sections):
        cell = tbl.cell(idx + 1, 0)
        cell.width = Inches(6.7)
        set_cell_background(cell, bg)
        set_cell_margins(cell, top=90, bottom=90, left=160, right=160)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        
        r_lbl = p.add_run(f"{label}\n")
        r_lbl.font.name = "Segoe UI"
        r_lbl.font.size = Pt(9.5)
        r_lbl.font.bold = True
        r_lbl.font.color.rgb = RGBColor(15, 118, 110) # Teal
        
        r_cnt = p.add_run(content)
        r_cnt.font.name = "Segoe UI"
        r_cnt.font.size = Pt(9)
        r_cnt.font.color.rgb = RGBColor(51, 65, 85)

    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def add_custom_heading(doc, text, level):
    """Tạo heading với định dạng màu sắc trang nhã"""
    h = doc.add_heading(text, level=level)
    h.paragraph_format.keep_with_next = True
    run = h.runs[0]
    run.font.name = "Segoe UI"
    
    if level == 1:
        h.paragraph_format.space_before = Pt(18)
        h.paragraph_format.space_after = Pt(8)
        run.font.size = Pt(14)
        run.font.bold = True
        run.font.color.rgb = RGBColor(30, 58, 138)  # Deep Navy Blue
    elif level == 2:
        h.paragraph_format.space_before = Pt(13)
        h.paragraph_format.space_after = Pt(5)
        run.font.size = Pt(12)
        run.font.bold = True
        run.font.color.rgb = RGBColor(15, 118, 110) # Teal
    elif level == 3:
        h.paragraph_format.space_before = Pt(9)
        h.paragraph_format.space_after = Pt(3)
        run.font.size = Pt(10.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(37, 99, 235)  # Royal Blue
    return h

def add_body_p(doc, text="", bold_prefix=None, space_after=4):
    """Thêm đoạn văn nội dung thường"""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.15
    
    if bold_prefix:
        r_pre = p.add_run(bold_prefix)
        r_pre.font.name = "Segoe UI"
        r_pre.font.size = Pt(9.5)
        r_pre.font.bold = True
        r_pre.font.color.rgb = RGBColor(17, 24, 39)
        
    if text:
        r = p.add_run(text)
        r.font.name = "Segoe UI"
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(31, 41, 55)
    return p

def add_bullet_p(doc, text="", bold_prefix=None):
    """Thêm mục danh sách đầu dòng"""
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(2.5)
    p.paragraph_format.line_spacing = 1.15
    
    if bold_prefix:
        r_pre = p.add_run(bold_prefix)
        r_pre.font.name = "Segoe UI"
        r_pre.font.size = Pt(9.5)
        r_pre.font.bold = True
        r_pre.font.color.rgb = RGBColor(17, 24, 39)
        
    if text:
        r = p.add_run(text)
        r.font.name = "Segoe UI"
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(31, 41, 55)
    return p

def create_table(doc, headers, data, col_widths=None):
    """Tạo bảng dữ liệu đẹp mắt với màu tiêu đề chuẩn"""
    tbl = doc.add_table(rows=len(data) + 1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(tbl)
    
    # Header Row
    hdr_row = tbl.rows[0]
    trPr = hdr_row._tr.get_or_add_trPr()
    trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))
    
    for i, title in enumerate(headers):
        cell = hdr_row.cells[i]
        set_cell_background(cell, "1E3A8A") # Deep Navy
        set_cell_margins(cell, top=100, bottom=100, left=120, right=120)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(title)
        r.font.name = "Segoe UI"
        r.font.size = Pt(9)
        r.font.bold = True
        r.font.color.rgb = RGBColor(255, 255, 255)
        
    # Data Rows
    for r_idx, row_data in enumerate(data):
        row = tbl.rows[r_idx + 1]
        bg = "F9FAFB" if r_idx % 2 == 1 else "FFFFFF"
        for c_idx, val in enumerate(row_data):
            cell = row.cells[c_idx]
            if bg != "FFFFFF":
                set_cell_background(cell, bg)
            set_cell_margins(cell, top=80, bottom=80, left=120, right=120)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.15
            r = p.add_run(str(val))
            r.font.name = "Segoe UI"
            r.font.size = Pt(8.5)
            r.font.color.rgb = RGBColor(31, 41, 55)
            
    # Set Col Widths
    if col_widths:
        for row in tbl.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = Inches(w)
                
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return tbl

def add_three_tier_box(doc, feature_name, frontend_logic, backend_logic, microservice_logic):
    """
    Thêm bảng phân tích kiến trúc 3 tầng:
    1. Frontend xử lý như thế nào
    2. Backend & Database xử lý như thế nào
    3. Microservices & Message Queue điều phối như thế nào
    """
    tbl = doc.add_table(rows=4, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(tbl, color="CBD5E1", sz="6")

    # Row 0: Header
    c0 = tbl.cell(0, 0)
    c0.width = Inches(6.7)
    set_cell_background(c0, "1E3A8A") # Navy Blue
    set_cell_margins(c0, top=120, bottom=120, left=160, right=160)
    p0 = c0.paragraphs[0]
    p0.paragraph_format.space_before = Pt(0)
    p0.paragraph_format.space_after = Pt(0)
    r0 = p0.add_run(f"🏗️ PHÂN TÍCH KIẾN TRÚC 3 TẦNG: {feature_name.upper()}")
    r0.font.name = "Segoe UI"
    r0.font.size = Pt(10)
    r0.font.bold = True
    r0.font.color.rgb = RGBColor(255, 255, 255)

    tiers = [
        ("🖥️ TẦNG 1: FRONTEND XỬ LÝ (REACT 18 SPA)", frontend_logic, "EFF6FF", "2563EB"),
        ("⚙️ TẦNG 2: BACKEND & DATABASE XỬ LÝ (LOGIC NGHIỆP VỤ & TRANSACTION)", backend_logic, "F0FDF4", "059669"),
        ("🌐 TẦNG 3: MICROSERVICES & HẠ TẦNG ĐIỀU PHỐI (GATEWAY, RABBITMQ, WORKERS)", microservice_logic, "FAF5FF", "7C3AED")
    ]

    for idx, (label, content, bg_hex, border_hex) in enumerate(tiers, start=1):
        cell = tbl.cell(idx, 0)
        cell.width = Inches(6.7)
        set_cell_background(cell, bg_hex)
        set_cell_margins(cell, top=100, bottom=100, left=160, right=160)
        
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'  <w:left w:val="single" w:sz="18" w:space="0" w:color="{border_hex}"/>'
            f'  <w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
            f'  <w:right w:val="none"/>'
            f'  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
            f'</w:tcBorders>'
        )
        tcPr.append(borders)
        
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        
        r_lbl = p.add_run(f"{label}\n")
        r_lbl.font.name = "Segoe UI"
        r_lbl.font.size = Pt(9.5)
        r_lbl.font.bold = True
        
        # Color matching
        if "FRONTEND" in label:
            r_lbl.font.color.rgb = RGBColor(29, 78, 216)
        elif "BACKEND" in label:
            r_lbl.font.color.rgb = RGBColor(4, 120, 87)
        else:
            r_lbl.font.color.rgb = RGBColor(109, 40, 217)
            
        r_txt = p.add_run(content.strip())
        r_txt.font.name = "Segoe UI"
        r_txt.font.size = Pt(9)
        r_txt.font.color.rgb = RGBColor(31, 41, 55)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)
