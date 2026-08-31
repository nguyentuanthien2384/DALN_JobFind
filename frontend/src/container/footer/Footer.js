import React from "react";

const Footer = () => {
  return (
    <>
      <footer>
        {/* <!-- Footer Start--> */}

        {/* <!-- footer-bottom area --> */}
        <div className="footer-bottom-area footer-bg">
          <div className="container">
            <div className="footer-border">
              <div className="row d-flex justify-content-between align-items-center">
                <div className="col-xl-10 col-lg-10 ">
                  <div className="footer-copy-right">
                    <p>
                      Bản quyền &copy; {new Date().getFullYear()} JobFind
                    </p>
                  </div>
                </div>
                <div className="col-xl-2 col-lg-2">
                  <div className="footer-social f-right">
                    <a
                      href="https://www.facebook.com/ahitvzed/"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Facebook JobFind"
                    >
                      <i className="fab fa-facebook-f"></i>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
};

export default Footer;
