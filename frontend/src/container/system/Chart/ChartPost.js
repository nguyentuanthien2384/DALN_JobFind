import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { getSumByYearPost } from '../../../service/userService';
import Chart from 'chart.js/auto';
import { Col, Row, Select } from 'antd';
import useAutoRefresh from '../../../util/useAutoRefresh';
import AutoRefreshInfo from '../AutoRefreshInfo';

// Danh sach nam duoc sinh tu nam hien tai lui ve 2020, thay vi viet cung
// 2020-2022 nhu truoc. Truoc day o khung chon chi co toi 2022 trong khi gia tri
// mac dinh la nam hien tai, nen chon sang nam khac roi thi khong con duong quay
// lai nam hien tai, va du lieu tu 2023 tro di khong xem duoc.
const taoDanhSachNam = () => {
    const namHienTai = new Date().getFullYear();
    const ds = [];
    for (let nam = namHienTai; nam >= 2020; nam--) {
        ds.push({ value: nam, label: String(nam) });
    }
    return ds;
};

function ChartPost() {
    const [valueYear,setValueYear] = useState(new Date().getFullYear())
    const options = {
        legend: { display: false },
        title: {
          display: true,
          text: "Chart Post"
        }
    }
    const yearOptions = taoDanhSachNam()
    const defaultMonthModel = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
        10: 0,
        11: 0,
        12: 0
      };
      const labelsMonth = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec'
      ];

    const [data,setData] = useState({
        labels: labelsMonth,
        datasets: []
    })

    let getData = async ()=> {
        let res = await getSumByYearPost(valueYear)
        if (res.errCode === 0) {
            let monthModel = { ...defaultMonthModel };
            res.data.forEach((item) => {
              monthModel[item.month] = item.total;
            });
            let newData = []
            for (let key in monthModel) {
                newData.push(monthModel[key])
            }
            setData({
                labels: labelsMonth,
                datasets: [{
                    label: 'USD',
                    data: newData
                }]
            })
        }

    }
    let handleOnChange = (value)=> {
        setValueYear(value)
    }

    // Truoc day do thi chi ve dung mot lan luc mo trang. Nay tai lai khi backend
    // bao co don hang moi (socket), dinh ky phong khi socket khong ket noi duoc,
    // va khi quay lai tab.
    const { capNhatLuc, dangTai, lamMoi } = useAutoRefresh(getData)

    // Doi nam cung di qua lamMoi de dai bang "cap nhat luc" chay theo luon.
    useEffect(()=> {
        lamMoi()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[valueYear])
    return (
        <div className="col-12 grid-margin">
        <div className="card">
            <div className="card-body">
                <h4 className="card-title">Đồ thị doanh thu các gói bài đăng</h4>
                <Row>
                            <Col xs={12} xxl={12}>
                                <Select onChange={(value) => handleOnChange(value)} style={{ width: '50%' }} size='default' value={valueYear} options={yearOptions}>

                                </Select>
                            </Col>

                </Row>
                <AutoRefreshInfo capNhatLuc={capNhatLuc} dangTai={dangTai} onLamMoi={lamMoi} />
                <Bar
                data={data}
                options={options}/>
            </div>
        </div>
    </div>
    );
}

export default ChartPost;